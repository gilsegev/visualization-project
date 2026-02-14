Goal: Migrate to OpenRouter and implement a "Forensic" logging system to ensure total visibility before we re-introduce batching.

1. Dependency & Configuration:

    Install the openai package: npm install openai.

    In .env, add OPENROUTER_API_KEY and set OPENROUTER_MODEL=google/gemini-2.0-flash-001.

    Remove the @google/generative-ai dependency if it is no longer needed.

2. Strategy Refactor (OpenRouter Migration):

    In HtmlInfographicStrategy.ts, replace the GoogleGenerativeAI client with the OpenAI client.

    Configure the client using the OpenRouter base URL: https://openrouter.ai/api/v1.

    Include the required headers: HTTP-Referer and X-Title.

    Update the generateBlueprint method to use the openai.chat.completions.create format. Ensure the system prompt strictly requests JSON-only output.

3. "Loud" Forensic Logging:

    To bypass log-level filters, implement all debug messages using console.log with a [FORENSIC] prefix.

    Logs Required:

        [FORENSIC] Strategy Input: {prompt}

        [FORENSIC] LLM Blueprint Result: {json_content}

        [FORENSIC] SiliconFlow Image Prompt: {full_prompt_string}

        [FORENSIC] HTML Autopsy: Saving file to {path}

4. HTML Autopsy Export:

    Inside performGeneration, implement a block to save the finalHtml string to the filesystem immediately before the Playwright screenshot is taken.

    Path: public/generated-images/debug_last_run.html.

    Reliability: Use fs.mkdirSync with { recursive: true } on the parent directory to ensure the save never fails silently.

5. Verification Test:

    Execute a single infographic generation using the existing playground/test script (e.g., "History of the NBA").

    Validation: 1.  Verify the terminal prints the [FORENSIC] logs.
    2.  Verify the debug_last_run.html file is created and contains the full DOM.
    3.  Confirm the image is generated via OpenRouter without 429 errors.

Validation Requirement: Provide the terminal output showing the [FORENSIC] logs and confirmation that the debug_last_run.html was successfully written to disk.