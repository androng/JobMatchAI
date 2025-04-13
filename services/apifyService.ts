import { ApifyClient } from 'apify-client';
const PQueue = (await import('p-queue')).default;
import fs from 'fs';
import path from 'path';
import { log } from './loggingService.js';  
import { readJSONFromFile } from './fileService.js';  
import { ApifyActor, UnparsedJobList, Job } from '../types.js'; 

const APIFY_API_KEY = process.env.APIFY_API_KEY;

interface ApifyActorJob {
    apifyActor: ApifyActor;
    filePath: string;
}

interface FailedInput {
    file: string;
    error: string;
}

const apifyActors: ApifyActor[] = [
    {
        id: "vQO5g45mnm8jwognj",
        name: "memo23/apify-ziprecruiter-scraper"
    },
    {
        id: "qA8rz8tR61HdkfTBL",
        name: "curious_coder/indeed-scraper"
    }, 
    {
        id: "hKByXkMQaC5Qt9UMN",
        name: "curious_coder/linkedin-jobs-scraper"
    }
]; 

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
                    jobUrl: job.ApplyURL || job.Href,
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
async function scrapeJobs(): Promise<UnparsedJobList[]> {
    log('INFO', 'Initializing Apify client...');

    if (!APIFY_API_KEY) {
        const ERROR_MESSAGE = 'APIFY_API_KEY is not set in the environment variables.';
        log('ERROR', ERROR_MESSAGE);
        throw new Error(ERROR_MESSAGE);
    }

    const client = new ApifyClient({ token: APIFY_API_KEY });

    // Create outputs directory if it doesn't exist
    const outputDir = 'apify_outputs';
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // Get all input files for all actors
    const inputDir = 'apify_inputs';
    log('INFO', `Reading input files from ${inputDir}...`);
    
    const inputFiles: ApifyActorJob[] = apifyActors.flatMap(apifyActor => {
        const inputPattern = `${apifyActor.id}_.*\\.json`;
        return fs.readdirSync(inputDir)
            .filter(file => file.match(inputPattern))
            .map(file => ({
                apifyActor,
                filePath: path.join(inputDir, file)
            }));
    });

    if (inputFiles.length === 0) {
        log('WARNING', 'No input files found for any Apify actors');
        return [];
    }

    let allResults: UnparsedJobList[] = [];
    const failedInputs: FailedInput[] = [];

    // Apify starter plan is 32 GB memory and 10 concurrent jobs. Jobs take up 4 GB each.
    const queue = new PQueue({ concurrency: 8 }); 

    const processJob = async ({ apifyActor, filePath }: ApifyActorJob): Promise<UnparsedJobList | null> => {
        try {
            const input = readJSONFromFile(filePath);
            log('INFO', `Running Apify actor ${apifyActor.name} with input from ${filePath}...`);
            
            const run = await client.actor(apifyActor.id).call(input);
            log('INFO', 'Fetching job results from the dataset...');
            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            log('INFO', `Successfully fetched ${items.length} jobs from ${filePath}`);
            
            const inputFileName = path.basename(filePath);
            const outputFileName = inputFileName.replace('.json', `_output_${new Date().toISOString()}.json`);
            const outputPath = path.join(outputDir, outputFileName);
            
            const result: UnparsedJobList = {
                actorId: apifyActor.id,
                actorName: apifyActor.name,
                unparsed_jobs: items
            };
            
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
            log('INFO', `Wrote ${items.length} results to ${outputPath}`);
            
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log('ERROR', `Error during job scraping for ${filePath}`, { error: errorMessage });
            failedInputs.push({ file: filePath, error: errorMessage });
            return null;
        }
    };

    // Add all jobs to the queue
    const promises = inputFiles.map(jobInfo => 
        queue.add(() => processJob(jobInfo))
    );

    // Wait for all jobs to complete and filter out null results
    const results = await Promise.all(promises);
    allResults = results.filter((result): result is UnparsedJobList => result !== null);
    
    // Log summary of results
    log('INFO', `Total job lists fetched: ${allResults.length}`);
    if (failedInputs.length > 0) {
        log('WARNING', `Failed to process ${failedInputs.length} input files:`, { failedInputs });
    }

    return allResults;
}

export { scrapeJobs , parseJobs};