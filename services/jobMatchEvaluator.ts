import OpenAI from 'openai';
import { log } from './loggingService.js';
import { Job, JobAiResponses } from '../types.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

// Replace the global client initialization with function-based clients
let openaiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

// Helper function to get or initialize the OpenAI client
function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openaiClient;
}

// Helper function to get or initialize the DeepSeek client
function getDeepSeekClient(): OpenAI {
    if (!deepseekClient) {
        deepseekClient = new OpenAI({
            baseURL: "https://api.deepseek.com",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });
    }
    return deepseekClient;
}

// Helper to generate job match prompt
function generateJobMatchPrompt(jobData: Job, candidateSummary: string) {
    return `Job Match Percentage Calculation Prompt:

    [ROLE] Job Match Evaluator
    [TASK] Assess the compatibility between the job requirements and the candidate's profile. Provide a match percentage based on the following criteria:
        - A% (Employer Fit Score): How well the candidate's skills, experience, and qualifications match the employer's need
        - B% (Candidate Fit Score): How well the job aligns with the candidate's preferences (e.g., role, location, salary, company type).  
        
    [INPUTS]    
        - <JOB_SUMMARY> ${JSON.stringify(jobData)} </JOB_SUMMARY>
        - <CANDIDATE_SUMMARY> ${candidateSummary} </CANDIDATE_SUMMARY>
    [OUTPUT]
        - A, B as comma separated values, no % symbol, no markdown. eg 50,50
        - and then the primary reasons for the scores in the third argument. e.g. 50,50,"❌requires bilingual,  ✅ on career track, ❌dead end job" or any other insight. Put all reasons on one line.
        - If there is an error then output the error instead. e.g. if something is missing
    `;
}

async function evaluateJobMatch(jobData: Job, candidateSummary: string): Promise<JobAiResponses> {
    const results: JobAiResponses = {
        gptJobSummary: "",
        gptMeetsEmployerRequirements: "",
        gptMeetsCandidateRequirements: "",
        gptJobMatchPercentage: "",
        gptJobMatchPercentageReasons: "",
        deepSeekJobSummary: "",
        deepSeekJobMatchPercentage: "",
        date_generated: new Date(),
    };

    // Check if either parameter is empty
    if (!candidateSummary || candidateSummary.includes("[your resume]")) {
        const ERROR_MESSAGE = "Candidate summary is empty";
        log("ERROR", ERROR_MESSAGE);
        throw new Error(ERROR_MESSAGE);
    }
    if (!jobData) {
        log("ERROR", "Job data is empty");
        return results;
    }

    // Check environment variables for GPT and DeepSeek usage
    const useGPT = process.env.USE_GPT === "true";
    const useDeepSeek = process.env.USE_DEEPSEEK === "true";

    if (useGPT) {
        try {

            // Generate job match percentage with GPT
            const gptMatchPrompt = generateJobMatchPrompt(jobData, candidateSummary);
            // log("DEBUG", "GPT Match Prompt:", gptMatchPrompt);
            const gptMatchResponse = await getOpenAIClient().chat.completions.create({
                model: "o1-mini", // results were very bad with gpt-4-turbo when I first tried it. 
                messages: [
                    {
                        role: "user",
                        content: gptMatchPrompt,
                    },
                ],
            });
            results.gptJobMatchPercentage = gptMatchResponse.choices[0]?.message?.content?.trim() || "";
            log("INFO", "GPT Processed Job Match", { gptJobMatchPercentage: results.gptJobMatchPercentage });

        } catch (error) {
            log("ERROR", "Error processing GPT job match:", (error as Error).message);
            results.gptJobMatchPercentage = `${(error as Error).message}`;
        }
    }

    if (useDeepSeek) {
        try {
            // Generate job match percentage with DeepSeek
            const deepSeekMatchResponse = await getDeepSeekClient().chat.completions.create({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "user",
                        content: generateJobMatchPrompt(jobData, candidateSummary),
                    },
                ],
            });
            results.deepSeekJobMatchPercentage = deepSeekMatchResponse.choices[0]?.message?.content?.trim() || "";
            log("INFO", "DeepSeek Processed Job Match", { deepSeekJobMatchPercentage: results.deepSeekJobMatchPercentage });

        } catch (error) {
            log("ERROR", "Error processing DeepSeek job match:", (error as Error).message);
        }
    }

    return results;
}


async function generateBatchFile(jobs: Job[], candidateSummary: string) {
    // Generate match requests
    const matchRequests = jobs.map((job, index) => ({
        custom_id: `match-${index}`,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
            model: "o1-mini",
            messages: [
                {
                    role: "user",
                    content: generateJobMatchPrompt(job, candidateSummary)
                }
            ]
        }
    }));

    // Write file
    const matchJsonl = matchRequests.map(req => JSON.stringify(req)).join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchPath = `batch_files/matches_${timestamp}.jsonl`;

    await fs.promises.mkdir('batch_files', { recursive: true });
    await fs.promises.writeFile(batchPath, matchJsonl);

    return batchPath;
}

async function submitBatch(filePath: string): Promise<string> {
    const file = await getOpenAIClient().files.create({
        file: fs.createReadStream(filePath),
        purpose: "batch",
    });

    const batch = await getOpenAIClient().batches.create({
        input_file_id: file.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
    });

    return batch.id;
}

async function processErrorFile(errorFileId: string) {
    if (!errorFileId) {
        log("INFO", "No errors found in batch processing");
        return;
    }

    try {
        const errorFileResponse = await getOpenAIClient().files.content(errorFileId);
        const errorResults = await errorFileResponse.text();
        
        // Write raw error file to disk
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const errorLogPath = `batch_files/errors_${timestamp}.jsonl`;
        
        await fs.promises.writeFile(errorLogPath, errorResults);
        
        log("ERROR", "Batch processing encountered errors", { errorLogPath });

    } catch (error) {
        log("ERROR", "Failed to process error file", { error: (error as Error).stack });
        throw error;
    }
}
async function checkBatchStatus(batchId: string) {
    const batch = await getOpenAIClient().batches.retrieve(batchId);
    log("INFO", "Batch status " + batch.status + " " + JSON.stringify(batch.request_counts) );
    
    // If batch failed or has errors, process the error file
    if (batch.error_file_id || batch.status === 'failed') {
        await processErrorFile(batch.error_file_id!);
    }

    return {
        status: batch.status,
        outputFileId: batch.output_file_id,
        errorFileId: batch.error_file_id
    };
}

async function processBatchResults(outputFileId: string, jobs: Job[]): Promise<JobAiResponses[]> {
    log("INFO", "Processing batch results", { outputFileId });
    const fileResponse = await getOpenAIClient().files.content(outputFileId);
    const results = await fileResponse.text();
    
    // Write raw batch results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchOutputPath = `batch_files/output_${timestamp}.jsonl`;
    await fsPromises.writeFile(batchOutputPath, results);
    log("INFO", "Wrote batch output to file", { batchOutputPath });
    
    const processedResults = new Map<string, string>();
    
    results.split('\n')
        .filter((line: string) => line.trim())
        .forEach((line: string) => {
            const result = JSON.parse(line);
            const content = result.response.body.choices[0].message.content;
            processedResults.set(result.custom_id, content);
        });

    return jobs.map((_, index) => {
        const matchResult = processedResults.get(`match-${index}`) || "";
        let employerFit = "";
        let candidateFit = "";
        let matchPercentage = "";
        let matchPercentageReasons = "";
        
        try {
            // Try to parse the response using a regex pattern that's more robust
            const responsePattern = /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*"(.+)"$/;
            const match = matchResult.match(responsePattern);
            
            if (match) {
                // Successfully matched the expected format: A,B,"reasons"
                employerFit = match[1];
                candidateFit = match[2];
                matchPercentageReasons = match[3].trim();
                matchPercentage = (Math.round((parseFloat(employerFit) * parseFloat(candidateFit) / 100))).toString();
            } else {
                // Fall back to original approach if regex doesn't match
                const parts = matchResult.split(',');
                const a = parseFloat(parts[0]?.trim() || "0");
                const b = parseFloat(parts[1]?.trim() || "0");
                
                if (!isNaN(a) && !isNaN(b)) {
                    employerFit = a.toString();
                    candidateFit = b.toString();
                    matchPercentage = (Math.round((a * b / 100))).toString();
                    
                    // Try to extract reasons from the remaining parts
                    if (parts.length > 2) {
                        // Join everything after the second comma and remove any surrounding quotes
                        matchPercentageReasons = parts.slice(2).join(',')
                            .replace(/^"?(.+?)"?$/, '$1').trim();
                    }
                }
                else {
                    /* put everything in the reasons field */
                    matchPercentageReasons = matchResult;
                }
            }
        } catch (error) {
            log("WARN", "Failed to parse match result", { 
                matchResult, 
                error: (error as Error).message 
            });
            // Keep empty strings for the fields that couldn't be parsed
        }

        return {
            gptJobSummary: "",
            gptMeetsEmployerRequirements: employerFit,
            gptMeetsCandidateRequirements: candidateFit,
            gptJobMatchPercentage: matchPercentage,
            gptJobMatchPercentageReasons: matchPercentageReasons,
            deepSeekJobSummary: "",
            deepSeekJobMatchPercentage: "",
            date_generated: new Date(),
        };
    });
}

async function batchProcessJobs(jobs: Job[], candidateSummary: string) {
    try {
        // Generate batch file
        const batchPath = await generateBatchFile(jobs, candidateSummary);
        log("INFO", "Generated batch file", { batchPath });

        // Submit batch
        const batchId = await submitBatch(batchPath);
        log("INFO", "Submitted batch", { batchId });
        // In case something went wrong, use hardcoded batch id here
        // const batchId = "batch_67b70acc11888190a8dd46c9bd300b5c";

        // Poll for completion with exponential backoff but a max of 10 minutes
        let pollInterval = 1000; // 1 second
        const MAX_POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes
        // set date 24 hours from now
        const TIMEOUT = new Date(Date.now() + 24 * 60 * 60 * 1000);

        while (true) { // Simple polling loop
            if (new Date() > TIMEOUT) {
                throw new Error("Batch processing timeout");
            }
        
            const batchStatus = await checkBatchStatus(batchId);
        
            if (batchStatus.status === 'failed' 
                || batchStatus.status === 'cancelled'
                || batchStatus.status === 'expired') {
                throw new Error("Batch processing " + batchStatus.status);
            }
        
            if (batchStatus.status === 'completed') {
                // Even if completed, there might be partial errors
                if (batchStatus.errorFileId) {
                    log("WARN", "Batch completed with some errors");
                    await processErrorFile(batchStatus.errorFileId);
                }
                return await processBatchResults(batchStatus.outputFileId!, jobs);
            }
        
            // Exponential backoff for polling
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            pollInterval = Math.min(pollInterval * 1.2, MAX_POLL_INTERVAL);
        }

    } catch (error) {
        log("ERROR", "Batch processing failed", { error: (error as Error).message });
        throw error;
    }
}


export {
    evaluateJobMatch,
    batchProcessJobs,

};