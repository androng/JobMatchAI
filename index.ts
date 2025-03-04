import 'dotenv/config';
import { scrapeJobs } from './services/apifyService.js';
import { readJSONFromFile } from './services/fileService.js';
import { readJobsFromSheet, writeJobToSheet, writeJobsToSheet } from './services/googleSheetsService.js';
import { filterDuplicateJobs } from './services/jobUtils.js';
import { batchProcessJobs } from './services/jobMatchEvaluator.js';
import { log } from './services/loggingService.js';
import { evaluateJobMatch } from './services/jobMatchEvaluator.js';
import { readFileSync, readdirSync } from 'fs';
import { Job, JobAiResponses, UnparsedJobList } from './types.js';
const candidateSummary = readFileSync('./candidate_summary.txt', 'utf8');
const useDebugMode = process.env.DEBUG_MODE === "true";


function parseJobs(jobLists: UnparsedJobList[]): Job[] {
    return jobLists.flatMap(jobList => {
        switch (jobList.actorName) {
            case 'curious_coder/linkedin-jobs-scraper':
                return jobList.unparsed_jobs.map((job: any) => ({
                    title: job.title,
                    companyName: job.companyName,
                    location: job.location,
                    jobUrl: job.link,
                    pay: job.salaryInfo.join(' - '),
                    contractType: job.employmentType,
                    description: job.descriptionText + '\n' + job.companyDescription,
                    source: `LinkedIn via Apify https://console.apify.com/actors/${jobList.actorId}/information/latest/readme`
                }));
            case 'memo23/apify-ziprecruiter-scraper':
                return jobList.unparsed_jobs.map((job: any) => ({
                    title: job.Title,
                    companyName: job.OrgName,
                    location: job.City,
                    jobUrl: job.Href,
                    pay: job.FormattedSalaryShort,
                    contractType: job.EmploymentType,
                    description: job.description,
                    source: `ZipRecruiter via Apify https://console.apify.com/actors/${jobList.actorId}/information/latest/readme`
                }));
            case 'curious_coder/indeed-scraper':
                return jobList.unparsed_jobs.map((job: any) => ({
                    title: job.displayTitle,
                    companyName: job.company,
                    location: job.jobLocationCity,
                    jobUrl: job.thirdPartyApplyUrl?.replace('indeed.com//', 'indeed.com/'),
                    pay: job.salarySnippet.text,
                    contractType: job.jobTypes[0] || '',
                    description: job.jobDescription,
                    source: `Indeed via Apify https://console.apify.com/actors/${jobList.actorId}/information/latest/readme`
                }));
            default:
                log('WARN', `No parser found for actor: ${jobList.actorName}`);
                return [];
        }
    });
}
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

            // sort all the jobs by match percentage in descending order
            jobResults.sort((a, b) => {
                const scoreA = Number(a.gptJobMatchPercentage || 0);
                const scoreB = Number(b.gptJobMatchPercentage || 0);
                return scoreB - scoreA;
            });
            
            // Step 5: Write to sheets in batches (the "recommended" limit is 2 MB of data per call)
            const BATCH_SIZE = 1000;
            for (let i = 0; i < uniqueJobs.length; i += BATCH_SIZE) {
                const jobBatch = uniqueJobs.slice(i, i + BATCH_SIZE);
                const resultsBatch = jobResults.slice(i, i + BATCH_SIZE);
                
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
