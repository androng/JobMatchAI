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
const candidateSummary = readFileSync('./candidate_summary.txt', 'utf8');
const useDebugMode = process.env.DEBUG_MODE === "true";


async function main() {
    log('INFO', 'Starting Job Scraper Workflow...');
    /* The job scraping is done in parallel. This script will wait for all Apify actors/jobs to finish before the GPT evaluation to prevent GPT from processing duplicate jobs from different searches/Apify actors. 
    
    Alternatively, to lower latency, the GPT evaluation can be done with a queue where one Apify run is filtered at a time. Two Apify runs at a time might have duplicate jobs.  
    */
    try {
        let unparsedJobs: UnparsedJobList[] = [];
        if (useDebugMode) {
            // hardcode the Apify output file for debugging
            // unparsedJobs = [
            //     readJSONFromFile("apify_outputs/andrew-test.json"),
            // ]
            
            // Read all JSON files from apify_outputs directory
            const files = readdirSync('apify_outputs')
                .filter(file => file.endsWith('.json'));
            
            unparsedJobs = files.map(file => 
                readJSONFromFile(`apify_outputs/${file}`)
            );

            // unparsedJobs = unparsedJobs.slice(0, 1);
            
        } else {
            // Step 1: Scrape jobs from ALL input files and save them to files
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

        const BATCH = true; // Batch = 50% OpenAI discount in exchange for 24h or less completion time
        /* Batch dashboard to cancel batches: https://platform.openai.com/batches/ */


        if (BATCH) { 
             // Step 4: Process all jobs in batch
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
            const BATCH_SIZE = 1000;
            for (let i = 0; i < pairedJobData.length; i += BATCH_SIZE) {
                const batchPairs = pairedJobData.slice(i, i + BATCH_SIZE);
                const jobBatch = batchPairs.map(pair => pair.job);
                const resultsBatch = batchPairs.map(pair => pair.result);
                
                await writeJobsToSheet(jobBatch, resultsBatch)
                
                // Add delay between batches
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        else {
            // Step 4: Write unique jobs to Google Sheets one by one
            let writtenCount = 0;
            for (const job of uniqueJobs) {
                const jobAiResponses = await evaluateJobMatch(job, candidateSummary);
                await writeJobToSheet(job, jobAiResponses);
                writtenCount++;
            }
            log("INFO", `${writtenCount} unique jobs successfully written to Google Sheets.`);
        }

    } catch (error) {
        log('ERROR', 'Workflow failed.', { error: (error as Error).stack });
    }
}

main();
