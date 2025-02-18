require('dotenv').config();
const { scrapeJobs } = require('./services/apifyService');
const { saveJobsToFile, readJobsFromFile } = require('./services/fileService');
const { readJobsFromSheet, writeJobToSheet } = require('./services/googleSheetsService');
const { filterDuplicateJobs } = require('./services/jobUtils');
const { log } = require('./services/loggingService');
const { evaluateJobMatch } = require('./services/jobMatchEvaluator');
const candidateSummary = require('fs').readFileSync('./candidate_summary.txt', 'utf8');

const useDebugMode = process.env.DEBUG_MODE === "true";

async function main() {
    log('INFO', 'Starting Job Scraper Workflow...');
    try {
        let jobs;
        if (useDebugMode) {
            jobs = readJobsFromFile("apify_outputs/vQO5g45mnm8jwognj_1_output_2025-02-16T22:40:44.580Z.json")
        } else {
            // Step 1: Scrape jobs
            jobs = await scrapeJobs();

            // Step 2: Save jobs to a JSON file
            if (jobs.length > 0) {
                saveJobsToFile(jobs);
            } else {
                log("WARN", "No jobs found. Skipping file saving step.");
            }
        }

        // Step 3: Filter out duplicates
        const sheetData = await readJobsFromSheet();
        const existingJobs = sheetData.slice(1);
        const uniqueJobs = filterDuplicateJobs(existingJobs, jobs);

        // Step 4: Write unique jobs to Google Sheets one by one
        let writtenCount = 0;
        for (const job of uniqueJobs) {
            const jobAiResponses = await evaluateJobMatch(job, candidateSummary);
            await writeJobToSheet(job, jobAiResponses);
            writtenCount++;
        }
        log("INFO", `${writtenCount} unique jobs successfully written to Google Sheets.`);

    } catch (error) {
        log('ERROR', 'Workflow failed.', { error: (error as Error).stack });
    }
}

main();
