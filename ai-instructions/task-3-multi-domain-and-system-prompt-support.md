<!-- /*
 * Ankur Mursalin
 *
 * https://encryptioner.github.io/
 *
 * Created on Mon Sep 01 2025
 */ -->

<!-- ## NOTE: You may use below instruction in claude from systematic command on claude
Assess the @ai-instructions/task-3-multi-domain-and-system-prompt-support.md file if u haven't already. 
Then follow the instructions of last instruction list of the file
Check this for reference: https://github.com/Encryptioner/markdown-to-slide/blob/master/ai-instructions/task-1-initial-setup.md -->


# Task 2: Multi Domain & System Prompt Support - Instructions

## General Rules
1. Assess summary of your earlier tasks in `ai-summaries/task-3-multi-domain-and-system-prompt-support` file if you haven't already. And write or update the summary of your updates in that file when all the current commanded tasks/instructions are done. Keep it short, concise, to-the-point. Include summary of key files changed (with info on functionality changed). You may update it in chronological way by step 1, step 2 and so on. It should reflect the continuos changes done on the codebase.
2. If the instruction lists are not chronological, fix them.
3. You may check other instructions and summaries related to this in `ai-instructions` & `ai-summaries` directory
4. You should only check inside the `local-llm-on-browser-test` directory for other projects


## Instruction List 1

### Instructions
1. While checking with larger prompt, got this error
   @wllama_wllama_esm.js?v=d74c3d81:2911 Uncaught (in promise) WllamaError: Running out of context cache. Please increase n_ctx when loading the model

### Comments
1. Updated `n_ctx` after that to `4096`. Updated text length there too


## Instruction List 2

### Instructions
1. Check the changes in `utils/constants.ts` file in `markdown-to-slide` file. There u will see we have added query param. So, we need to updated `embed.ts` file here in a way that it can support optional query param like `system`, `domain` and many more.
2. It should be handled in a way that, existing functionality works ok. And when the main website will load, in `App.jsx` file, those query param can be accessed via `window.location.search` or other way so that, it can set `setCustomSystemMessage`. This should work for both standalone, github pages and iframe (where the website loads)

### Comments
1. Added handling query param which seems working 