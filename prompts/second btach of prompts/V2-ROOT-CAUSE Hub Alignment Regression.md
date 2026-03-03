Goal: Identify and remove the manual offset logic in the HtmlInfographicStrategy that is conflicting with the CSS transform centering.

1. The Investigation (File: src/strategies/HtmlInfographicStrategy.ts):

    Analyze the Hub Generation Path: Locate the loop responsible for calculating and applying coordinates for the hub_radial template.

    Identify the Offset Bug: Look for any logic where the calculated left or top values are being modified before being applied to the element's style attribute.

        Example of what to look for: element.style.left = (mathLeft - 25) + 'px';

    Check the Applied Styles: In the recent debug output, the calculated coordinate was 600px but the applied style was 575px. Find the code responsible for this −25px subtraction.

2. The Fix (Rooting out the Conflict):

    Revert to Pure Coordinates: Remove any manual subtractions or "assumed width/height" offsets.

    Direct Application: Ensure the code applies the calculated mathLeft and mathTop values directly to the style attribute without modification.

        Correct Logic: element.style.left = \${mathLeft}px`;`

    Trust the CSS: The template's CSS already uses transform: translate(-50%, -50%) to handle the centering. The JavaScript should only provide the anchor point.

3. Global Sweep:

    Review the versus_split and step_stone paths for similar "manual offset" logic. If any offsets exist there, remove them to ensure consistency across the fleet.

4. Verification:

    Run scripts/test-v2-diversity.ts.

    Requirement: In the generated HTML, the style="left: ...; top: ...;" values must exactly match the data-debug-mathLeft and data-debug-mathTop values.