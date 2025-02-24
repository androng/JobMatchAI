export interface Job {
    title: string;
    companyName: string;
    location: string; // City
    jobUrl: string;
    pay: string;
    contractType: string; // Full-time/ Part-time/ Contract/ Internship
    description: string;
    source: string; // LinkedIn/ ZipRecruiter/ Glassdoor/ Apify Actor ID
}

export interface JobAiResponses {
    gptJobSummary: string;
    gptJobMatchPercentage: string;
    deepSeekJobSummary: string;
    deepSeekJobMatchPercentage: string;
    date_generated: Date; // helps with debugging later when this script is run many times 
}

export interface ApifyActor {
    id: string;
    name: string;
}

export interface UnparsedJobList {
    actorId: string;
    actorName: string;
    unparsed_jobs: unknown[];
}