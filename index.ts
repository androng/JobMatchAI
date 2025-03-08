import 'dotenv/config';
import { scrapeJobs, parseJobs } from './services/apifyService.js';
import { readJSONFromFile } from './services/fileService.js';
import { readJobsFromSheet, writeJobToSheet, writeJobsToSheet } from './services/googleSheetsService.js';
import { filterDuplicateJobs } from './services/jobUtils.js';
import { batchProcessJobs } from './services/jobMatchEvaluator.js';
import { log } from './services/loggingService.js';
import { evaluateJobMatch } from './services/jobMatchEvaluator.js';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { Job, JobAiResponses, UnparsedJobList } from './types.js';
const useDebugMode = process.env.DEBUG_MODE === "true";

// Validate all required environment variables at startup
function validateEnvironment() {
    // Check if file exists
    if (!existsSync('./.env')) {
        log('ERROR', 'Missing required file: ', `.env`);
        log('INFO', 'Please rename .env.example to .env and add your API keys');
        process.exit(1);
    }   
    // Check if file exists
    if (!existsSync('./candidate_summary.txt')) {
        log('ERROR', 'Missing required file: ', `candidate_summary.txt`);
        log('INFO', 'Please rename candidate_summary.example.txt to candidate_summary.txt and add your resume and job preferences');
        process.exit(1);
    }   

    const requiredVars = [
        'APIFY_API_KEY',
        'SPREADSHEET_ID',
        'OPENAI_API_KEY',
    ];
    
    const missing = requiredVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
        log('ERROR', `Missing required environment variables:`, { missing });
        log('INFO', 'Please add these to your .env file');
        process.exit(1);
    }
    /* check spreadsheet ID is exactly 44 characters long */
    if (process.env.SPREADSHEET_ID?.length !== 44) {
        log('ERROR', 'SPREADSHEET_ID is not exactly 44 characters long');
        process.exit(1);
    }
}

async function main() {
    log('INFO', 'Starting Job Scraper Workflow...');

    validateEnvironment();
    
    const candidateSummary = readFileSync('./candidate_summary.txt', 'utf8');

    try {
        let unparsedJobs: UnparsedJobList[] = [];
        if (useDebugMode) {
            
            // Read all JSON files from apify_outputs directory. Useful if you already scraped the jobs and want to skip the scraping step. 
            const files = readdirSync('apify_outputs')
                .filter(file => file.endsWith('.json'));
            
            unparsedJobs = files.map(file => 
                readJSONFromFile(`apify_outputs/${file}`)
            );

            // unparsedJobs = unparsedJobs.slice(0, 1);
            
        } else {
            // Step 1: Scrape jobs from ALL input files and save them to files
            /* The job scraping is done in parallel. This script will wait for all Apify actors/jobs to finish before the GPT evaluation to prevent GPT from processing duplicate jobs from different searches/Apify actors. 
            
            Alternatively, to lower latency, the GPT evaluation can be done with a queue where one Apify run is filtered at a time. Two Apify runs at a time might have duplicate jobs.  
            */
            unparsedJobs = await scrapeJobs();
        }
        // Convert jobs to standard format
        let parsedJobs: Job[] = parseJobs(unparsedJobs);

        // Step 3: Filter out duplicates
        const sheetData = await readJobsFromSheet();
        const existingJobs = sheetData.slice(1);
        const uniqueJobs = filterDuplicateJobs(existingJobs, parsedJobs);
        if(uniqueJobs.length == 0){
            log("INFO", "No new jobs found");
            return;
        }

        if (true) { 
            // Step 4: Process all jobs in batch
            /* Batch = 50% OpenAI discount in exchange for 24h or less completion time
            Batch dashboard to cancel batches: https://platform.openai.com/batches/ */
            const jobResults: JobAiResponses[] = await batchProcessJobs(uniqueJobs, candidateSummary);

            // Create paired data to keep jobs and results together
            const pairedJobData = uniqueJobs.map((job, index) => ({
                job,
                result: jobResults[index]
            }));

            // Sort paired data by match percentage
            pairedJobData.sort((a, b) => {
                const scoreA = Number(a.result.gptJobMatchPercentage || 0);
                const scoreB = Number(b.result.gptJobMatchPercentage || 0);
                return scoreB - scoreA;
            });

            // Write sorted jobs to debug file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const debugDir = './processed_jobs';
            if (!existsSync(debugDir)) {
                mkdirSync(debugDir);
            }
            writeFileSync(
                `${debugDir}/sorted_jobs_${timestamp}.json`, 
                JSON.stringify(pairedJobData, null, 2)
            );
            
            // Step 5: Write to sheets in batches (the "recommended" limit is 2 MB of data per call)
            // This will write to the first empty row in the sheet and overwrite anything after that row
            const BATCH_SIZE = 1000;
            for (let i = 0; i < pairedJobData.length; i += BATCH_SIZE) {
                const batchPairs = pairedJobData.slice(i, i + BATCH_SIZE);
                const jobBatch = batchPairs.map(pair => pair.job);
                const resultsBatch = batchPairs.map(pair => pair.result);
                
                await writeJobsToSheet(jobBatch, resultsBatch)
                
                // Add delay between batches to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }


    } catch (error) {
        log('ERROR', 'Workflow failed.', { error: (error as Error).stack });
    }
}

main();
