The 12-Column Logic


    Task: Finalize Bento Grid Implementation

    1. Blueprint Mapping Logic:

        The LLM must generate a cells array where the total of all col_span and row_span combinations fits within a 12×12 matrix.

        Standard Hero Pattern: Assign one cell a [6×6] or [8×6] span to act as the primary visual anchor.

    2. Asset Pipeline Integration:

        The template is located at @/templates/bento.html. you must use this template to generate the HTML.
        Any cell with a type containing image must trigger the Parallel Image Generation logic.

        Save these assets to the local assets/ folder and map the relative paths into the JSON payload.

    3. Design Continuity:

        Ensure all text uses the Inter font-family defined in the styles.

        Maintain the 18px blur on the glass cards to match the course-wide aesthetic.

    4. Validation Case:

        Generate a "Cognitive Distortions" summary. Verify that each of the 7 distortions fits into a smaller [3×3] or [4×4] cell, while the summary note occupies a larger hero slot.