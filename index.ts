import 'dotenv/config';
import { scrapeJobs } from './services/apifyService.js';
import { readJSONFromFile } from './services/fileService.js';
import { readJobsFromSheet, writeJobToSheet, writeJobsToSheet } from './services/googleSheetsService.js';
import { filterDuplicateJobs } from './services/jobUtils.js';
import { batchProcessJobs } from './services/jobMatchEvaluator.js';
import { log } from './services/loggingService.js';
import { evaluateJobMatch } from './services/jobMatchEvaluator.js';
import { readFileSync } from 'fs';
import { Job, JobAiResponses, UnparsedJobList } from './types.js';
const candidateSummary = readFileSync('./candidate_summary.txt', 'utf8');
const useDebugMode = process.env.DEBUG_MODE === "true";


function parseJobs(jobLists: UnparsedJobList[]): Job[] {
    return jobLists.flatMap(jobList => {
        switch (jobList.actorName) {
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
    // TODO move the parallel scraping out of the apify function and into the main function
    try {
        let unparsedJobs: UnparsedJobList[] = [];
        if (useDebugMode) {

            // hardcode the Apify output file for debugging
            unparsedJobs = [
                readJSONFromFile("apify_outputs/qA8rz8tR61HdkfTBL_production_assistant_LA_output_2025-02-24T02:49:02.972Z.json"),
                readJSONFromFile("apify_outputs/qA8rz8tR61HdkfTBL_production_assistant_NY_output_2025-02-24T02:24:20.629Z.json"),
                readJSONFromFile("apify_outputs/qA8rz8tR61HdkfTBL_production_assistant_SD_output_2025-02-24T02:13:52.357Z.json"),
                readJSONFromFile("apify_outputs/qA8rz8tR61HdkfTBL_production_assistant_SF_output_2025-02-24T02:21:04.178Z.json"),
            ]
            
            
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
