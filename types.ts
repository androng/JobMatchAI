export interface Job {
    title: string;
    companyName: string;
    location: string;
    publishedAt: string;
    jobUrl: string;
    contractType: string;
    posterProfileUrl: string;
}

export interface JobAiResponses {
    gptJobSummary: string;
    gptJobMatchPercentage: string;
    deepSeekJobSummary: string;
    deepSeekJobMatchPercentage: string;
}