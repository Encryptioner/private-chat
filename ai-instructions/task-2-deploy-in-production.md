<!-- /*
 * Ankur Mursalin
 *
 * https://encryptioner.github.io/
 *
 * Created on Mon Sep 01 2025
 */ -->

<!-- ## NOTE: You may use below instruction in claude from systematic command on claude
Assess the @ai-instructions/task-1-task-2-deploy-in-production.md file if u haven't already. 
Then follow the instructions of last instruction list of the file
Check this for reference: https://github.com/Encryptioner/markdown-to-slide/blob/master/ai-instructions/task-1-initial-setup.md -->


# Task 2: Deploy in Production - Instructions

## General Rules
1. Assess summary of your earlier tasks in `ai-summaries/task-2-deploy-in-production` file if you haven't already. And write or update the summary of your updates in that file when all the current commanded tasks/instructions are done. Keep it short, concise, to-the-point. Include summary of key files changed (with info on functionality changed). You may update it in chronological way by step 1, step 2 and so on. It should reflect the continuos changes done on the codebase.
2. If the instruction lists are not chronological, fix them.
3. You may check other instructions and summaries related to this in `ai-instructions` & `ai-summaries` directory


## Instruction List 1

### Instructions
1. Ensure the project is production ready. Check env variables wherever needed
2. Update `readme/testing guide` if necessary. Create a `deployment guide` in `docs`
3. Ensure the project can be deployed in github pages. And the project can be run individually. As well as it can be loaded as chatbot for other websites


### Comments
1. It failed in `Install dependencies` state in `Github actions`. Updated it manually
2. Added package `prop-types`
3. There is issue



## Instruction List 2

### Instructions
1. The project will be deployed in github pages like `https://encryptioner.github.io/in-browser-llm-inference/embed.js"`. You should consider for production deployment. For Example: in vite config there could be below handling.
   const isProduction = command === 'build';
  const isDevelopment = command === 'serve';
  
  return {
  base: isProduction ? '/in-browser-llm-inference/' : '/',
2. Currently, When deployed in github pages, `https://encryptioner.github.io/in-browser-llm-inference` shows empty page.
3. And when loaded as chatbot in other website, say `https://encryptioner.github.io/markdown-to-slide`, on chat bot load, it shows this website `https://encryptioner.github.io`.
4. You may check the project `linkedinify`. And check how vite config is handled there.
5. You must ensure that, we can access the website in `https://encryptioner.github.io/in-browser-llm-inference` and also can load it as chatbot in `https://encryptioner.github.io/markdown-to-slide`.
6. Try to use constant variable and others. So that, we can change the url whenever necessary

### Comments
1. Need more update


## Instruction List 3

### Instructions
1. It is not ensured that, the site will always load in github pages. We may later deploy it in a standalone domain. So, define the constant and functionality in a way that, we can easily change it to standalone domain
2. Default will be github page for deployment

### Comments
1. It did some update. Need to check
2. Updated the github workflow little bit later
