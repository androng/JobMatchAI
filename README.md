# JobMatchAI

JobMatchAI is a Node.js application that automates job matching and evaluation processes using AI services (Deepseek & ChatGPT), and Google Sheets integration.

![Workflow Overview](./JobMatchAI-v1.png "Automated Job Search Workflow")

## Prerequisites

- Node.js (v16 or higher)
- NPM or Yarn
- Google Cloud Service Account credentials for accessing Google Sheets
- ChatGPT or Deep-seek API Key
- Apify API Key

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/EricTechPro/JobMatchAI
   cd jobmatchai
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:

   ```env
   APIFY_API_KEY=[apify api key]
   SPREADSHEET_ID=[google sheet spreadsheet id]
   DEEPSEEK_API_KEY=[deep-seek ai api key]
   OPENAI_API_KEY=[open ai api key]
   USE_GPT=[true or false]
   USE_DEEPSEEK=[true or false]
   DEBUG_MODE=[true or false]
   ```

4. Modify the Apify LinkedIn Job Scraper API Input from https://console.apify.com/actors/BHzefUZlZRKWxkTck/input and update "apify_input.json"

1. Add your resume to the "candidate_summary.txt" file.
## Usage

Start the application:

```bash
node index.js
```

## Dependencies

- [apify-client](https://www.npmjs.com/package/apify-client)
- [dotenv](https://www.npmjs.com/package/dotenv)
- [googleapis](https://www.npmjs.com/package/googleapis)
- [openai](https://www.npmjs.com/package/openai)

## Contributing

Contributions are welcome! Please fork this repository and submit a pull request for review.
