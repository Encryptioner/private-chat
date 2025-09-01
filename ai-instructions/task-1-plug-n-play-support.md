<!-- /*
 * Ankur Mursalin
 *
 * https://encryptioner.github.io/
 *
 * Created on Mon Sep 01 2025
 */ -->

<!-- ## NOTE: You may use below instruction in claude from systematic command on claude
Assess the @ai-instructions/task-1-task-1-plug-n-play-support.md file if u haven't already. 
Then follow the instructions of last instruction list of the file
Check this for reference: https://github.com/Encryptioner/markdown-to-slide/blob/master/ai-instructions/task-1-initial-setup.md -->


# Task 0: Initial Setup - Instructions

## General Rules
1. Assess summary of your earlier tasks in `ai-summaries/task-1-plug-n-play-support` file if you haven't already. And write or update the summary of your updates in that file when all the current commanded tasks/instructions are done. Keep it short, concise, to-the-point. Include summary of key files changed (with info on functionality changed). You may update it in chronological way by step 1, step 2 and so on. It should reflect the continuos changes done on the codebase.
2. If the instruction lists are not chronological, fix them.
3. Wherever, the project name or link is used, take it from constant. So that, it can be easily updated


## Instruction List 1

### Instructions
1. I want to make this website load as chat window in other browsers. I've already made similar implementation in `../../ai-chat-interface-web/*` project. Though it is in Vue. Understand it and make similar implementation and script for this project. However, there should have no backend validation. Everything should be on client side.
2. After implementing that, create `github actions` so that, this can be deployed in github pages as `https://user.github.io/<project-name>/`. And it can be served for other website to load
3. After implementing that, test it in the `../../markdown-to-slide/` website. When that website loads, there should be a chat icon on right bottom. Clicking on that, it will open a chat window integrated in that website. So, user can do chat from that domain

### Comments
1. Added instructions for the directory to use


## Instruction List 2

### Instructions
1. Create a guideline in `docs` directory of `in-browser-llm-inference` project on how to test this in dev and production
2. In the `markdown-to-slide` project, there should have a constant. where I can declare the url of the chat plug and play app.If the url is empty or not a valid url, the chat button won't show
3. Update readme of both projects to ensure one can easily test and understand how it works

### Comments
1. Test seems not working

## Instruction List 2

### Instructions
1. My project is running on `http://localhost:5173/embed.js`. I ran `pnpm build -> pnpm dev`. I'm loading the `test-embed.html` file. It shows `The chat should load below: Load Chat in Custom Div`. However, in console, there is below error. 
    Failed to load resource: the server responded with a status of 404 (Not Found) embed.js.1

### Comments
1. It's loads now. However, there is issue related to service worker


## Instruction List 2

### Instructions
1. In the console, there is this error. Fix that. Ensure it works and production ready. It can be tested in both dev and production.
   sw.js:40 Uncaught (in promise) ReferenceError: e is not defined
    at sw.js:40:25

### Comments
1. There is new error now


## Instruction List 2

### Instructions
1. There is this error in console. And when I run the website, there is this error
   The script has an unsupported MIME type ('text/html').Understand this error
    SecurityError: Failed to register a ServiceWorker for scope ('http://localhost:5173/') with script ('http://localhost:5173/sw.js'): The script has an unsupported MIME type ('text/html').
2. When I start chat, it gives this error. However, chatting works ok
   chunk-JC7SLT4N.js?v=b9ef1fa3:521 Warning: validateDOMNesting(...): <p> cannot appear as a descendant of <p>.
    at p
    at http://localhost:5173/node_modules/.vite/deps/@radix-ui_themes.js?v=68bc926b:252:13
    at http://localhost:5173/node_modules/.vite/deps/@radix-ui_themes.js?v=68bc926b:229:13
    at http://localhost:5173/node_modules/.vite/deps/@radix-ui_themes.js?v=68bc926b:15850:96
    at p (http://localhost:5173/src/components/Markdown.jsx:65:23)

### Comments
1. The service worker error is not present now. Good work.
2. The issue related to validate dom nesting in this project still exist. It could be existing issue. Not working on that.
3. Found issue in loading chat app in `markdown-to-slide`. Have to fix that
4. Compacted AI chat history. You may need to read this file fully again 


## Instruction List 3

### Instructions
1. When I start, `markdown-to-slide` project by pnpm dev, it gives this error. `intercept-console-error.ts:44 _loadApp -> No element found for id ai-chat-widget-container`
2. Also it should be in a way that, on the `markdown-to-slide` project, user doesn't have to create chat box/icon on his own. It should be setup using `in-browser-llm-inference` project. If necessary check `ai-chat-interface-web` project. It works as plug and play. If the embed script is present, it should work. Follow this info, in that readme
    If u want to load the chat assistant by default, ensure there is a html `div` element present on the time website first loads by id `ai-mate-chat-embed-div`. For example:
    ```
    <div v-show="!authStore.token">
    <div id="ai-mate-chat-embed-div" />
    </div>
    ```
    1. If u want to load the chat assistant later in your chosen div id, ensure there is a html `div` and assign an id to it. For example:
    ```
    <div id="ai-mate-chat-embed-div-2" />
3. If u have to update embed script and other docs do it.
4. Ensure it is production grade and easy to integrate in any website


### Comments
1. Design is updated. However, still has issue.


## Instruction List 4

### Instructions
1. I am testing wth `test-floating.html` button. When I load the chat interface, it shows, this error. However, it doesn't show error, when loading the website `http://localhost:5173`
   @wllama_wllama_esm.js?v=827a6848:2565 Uncaught (in promise) WllamaError: Module is already initialized
    at Wllama.<anonymous> (@wllama_wllama_esm.js?v=827a6848:2565:15)
    at Generator.next (<anonymous>)
    at @wllama_wllama_esm.js?v=827a6848:42:61
2. On click, the chat window will take majority portion of available website. So, it can viewed better. There should have option to minimize it. and load again. Ensure, after opening window from minimization.
3. Ensure localstorage, service worker caching of model works for it when loading in any different website
4. The chat button takes some time load, is it normal?

### Comments
1. There are some improvements. However, there is still error for `test-floating.html` & `markdown-to-slide` project.

## Instruction List 4

### Instructions
1. The module is already initialized error is still there. Fix it. Though this error is not making issue in chatting. However, it would be nice to see ir gone
   Uncaught (in promise) WllamaError: Module is already initialized
    at Wllama.<anonymous> (@wllama_wllama_esm.js?v=827a6848:2565:15)
    at Generator.next (<anonymous>)
    at @wllama_wllama_esm.js?v=827a6848:42:61
    at new Promise (<anonymous>)
    at __async (@wllama_wllama_esm.js?v=827a6848:26:10)
    at Wllama.loadModel (@wllama_wllama_esm.js?v=827a6848:2554:12)
    at Wllama.<anonymous> (@wllama_wllama_esm.js?v=827a6848:2521:25)
    at Generator.next (<anonymous>)
    at fulfilled (@wllama_wllama_esm.js?v=827a6848:29:24)

### Comments
1. The error is yet not fixed. It doesn't happen when I load the website only. It happens, when the website is loaded as chatbot in `test-floating.html`
   @wllama_wllama_esm.js?v=827a6848:2565 Uncaught (in promise) WllamaError: Module is already initialized
    at Wllama.<anonymous> (@wllama_wllama_esm.js?v=827a6848:2565:15)
    at Generator.next (<anonymous>)
    at @wllama_wllama_esm.js?v=827a6848:42:61
    at new Promise (<anonymous>)
    at __async (@wllama_wllama_esm.js?v=827a6848:26:10)
    at Wllama.loadModel (@wllama_wllama_esm.js?v=827a6848:2554:12)
    at Wllama.<anonymous> (@wllama_wllama_esm.js?v=827a6848:2521:25)
    at Generator.next (<anonymous>)
    at fulfilled (@wllama_wllama_esm.js?v=827a6848:29:24)Understand this error
2. Added this command laterYes. I've already loaded the http://localhost:5173/ in different tab. And this can happen. This same chatbot can be used 
  individually. And also in multiple website


## Instruction List 5

### Instructions
1. This error now shows. And when chatting, the chat keeps loading and not working.
   wllama.js:65 Uncaught (in promise) TypeError: wllamaInstance.getChatTemplate is not a function
    at formatChat (wllama.js:65:48)
    at submitPrompt (App.jsx:199:33)
    at handleOnPressEnter (App.jsx:216:58)


## Instruction List 6

### Instructions. The error is still present
1. The error is still present. wllama.js:65 Uncaught (in promise) TypeError: wllamaInstance.getChatTemplate is not a function
    at formatChat (wllama.js:65:48)
    at submitPrompt (App.jsx:199:33)


### Comments
1. Ran compact command after that