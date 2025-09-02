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


# Task 2: Multi Domain & System Prompt & New line & Better Visual  - Instructions

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
2. Compacted the chat


## Instruction List 3

### Instructions
1. In the chat input tab, on `Ctrl+enter`, it should create new line. Instead of sending the message
2. In the chat input tab, it should check max possible length allowed for chat input and will show that, how many character left
3. Check `ai-chat-interface-web` project. There chat looks better. It checks query and api response. And show the appropriate formatting or message. The codes shows as formatted input. Ensure it looks better and support every type of message

### Comments
1. The design is not up to the mark

## Instruction List 4

### Instructions
1. Sorry, it shouldn't be `ctrl+enter`. But it should be `shift+enter`
2. You must ensure there is at least one word there, skipping new line or spaces before allowing the chat send
3. The design is not up to the mark. It doesn't look good. You don't have to copy the design. Just ensure that, it looks good and goes with our site. Follow the best design


### Comments
1. Some improvement is still need


## Instruction List 5

### Instructions
1. If the message is sent, the chat text input should become empty
2. In chat thread, the vertical scrollbar shows over the texts. It looks odd. Ensure the text and scrollbar has minimal difference to look good

### Comments
1. Some improvement is still need



## Instruction List 6

### Instructions
1. There could have some space with the scrollbar to look good. Now it doesn't overlap. but too close

### Comments
1. have issue


## Instruction List 6

### Instructions
1. There should have max height in text area
2. The texts get cut horizontally in mobile and desktop. Ensure all texts are visible