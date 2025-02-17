const { ApifyClient } = require('apify-client');
const { log } = require('./loggingService');
const { readJSONFromFile } = require('./fileService');
const fs = require('fs');
const path = require('path');


const APIFY_API_KEY = process.env.APIFY_API_KEY;

/**
 * Scrapes jobs using the Apify API.
 * 
 * Expects a list of input files in the apify_inputs directory.
 * e.g. 
 * apify_inputs/vQO5g45mnm8jwognj_1.json
 * apify_inputs/vQO5g45mnm8jwognj_2.json
 * 
 * apify_inputs/PskQAJMqsgeJHXSDz_1.json
 * apify_inputs/PskQAJMqsgeJHXSDz_2.json
 * 
 * This helps with multiple searches ie different websites, different cities, different job titles, etc.
 * 
 * @returns {Promise<Array<Object>>} An array of job objects.
 */

async function scrapeJobs() {
    log('INFO', 'Initializing Apify client...');

    // Check if APIFY_API_KEY is set
    if (!APIFY_API_KEY) {
        const ERROR_MESSAGE = 'APIFY_API_KEY is not set in the environment variables.';
        log('ERROR', ERROR_MESSAGE);
        throw new Error(ERROR_MESSAGE);
    }

    const client = new ApifyClient({ token: APIFY_API_KEY });
    const actorId = "vQO5g45mnm8jwognj";

    // Create outputs directory if it doesn't exist
    const outputDir = 'apify_outputs';
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // Get all input files for this actor
    const inputDir = ('apify_inputs');
    log('INFO', `Reading input files from ${inputDir}...`);
    const inputPattern = `${actorId}_.*\.json`;
    const inputFiles = fs.readdirSync(inputDir)
        .filter(file => file.match(inputPattern))
        .map(file => path.join(inputDir, file));

    if (inputFiles.length === 0) {
        log('WARNING', `No input files found matching pattern: ${inputPattern}`);
        return [];
    }

    let allResults = [];
    let failedInputs = [];
    
    for (const inputFile of inputFiles) {
        try {
            const input = readJSONFromFile(inputFile);
            log('INFO', `Running Apify actor ${actorId} with input from ${inputFile}...`);
            
            const run = await client.actor(actorId).call(input);
            log('INFO', 'Fetching job results from the dataset...');
            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            log('INFO', `Successfully fetched ${items.length} jobs from ${inputFile}`);
            
            // Generate output filename based on input filename
            const inputFileName = path.basename(inputFile);
            const outputFileName = inputFileName.replace('.json', `_output_${new Date().toISOString()}.json`);
            const outputPath = path.join(outputDir, outputFileName);
            
            // Write results to output file
            fs.writeFileSync(outputPath, JSON.stringify(items, null, 2));
            log('INFO', `Wrote ${items.length} results to ${outputPath}`);
            
            allResults = [...allResults, ...items];
        } catch (error) {
            log('ERROR', `Error during job scraping for ${inputFile}`, { error: error.message });
            failedInputs.push({ file: inputFile, error: error.message });
            continue;
        }
    }
    
    // Log summary of results
    log('INFO', `Total jobs fetched: ${allResults.length}`);
    if (failedInputs.length > 0) {
        log('WARNING', `Failed to process ${failedInputs.length} input files:`, { failedInputs });
    }
    return allResults;
}

module.exports = { scrapeJobs };
