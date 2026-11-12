Handoff: Fix _js/svg2gcode.js SVG→Gcode conversion (Polargraph)
Current task
Make the web tool Polargraph-SVG2Gcode (cwd C:/Users/Thy/Dev/Polargraph-SVG2Gcode) generate G-code that matches the reference output produced by the official Polargraph Controller:

Input SVG: examples/lines.svg
Expected output: examples/lines.txt (20 C17 moves, ground truth)
The user deleted two stale backups (svg2gcode - Copie gemma27b.js, svg2gcode copy GEMMA.js) — don't restore them.

Completed so far
Fixed the xIn is not defined crash: the svg2gcode() function body in _js/svg2gcode.js had been clobbered (contained polargraphNative's code). Rewrote it to: parse via SVGReader.parse() → {allcolors: [[{x,y}]]}; map each point (unit − doc.minX) × mmPerUnit × scale + offsetX (mm) → polargraphNative(mx,my,cfg) → C09 (first) / C17 (rest), C14/C13 per path. Verified with Node harness (stubs). Also fixed index.html:169 script path → _js/compareCoords.js.
All helpers in _js/svg2gcode.js are good and must NOT be changed: polargraphNative(xIn,yIn,cfg) (units, quantize='all', inSteps=trunc(x+0.5)), svgDocumentInfo() (viewBox+width/height → unitToMM; no viewBox → 1 unit = 1px = 25.4/96 mm), nativeConfigFromParameters, resolveMachine, PX_TO_MM=25.4/96, PEN_DOWN_CMD='C13', PEN_UP_CMD='C14'.
Machine.pde (in read-only C:/Users/Thy/Dev/polargraphcontroller) confirms: stepsPerMM = stepsPerRev/mmPerRev (NO microstepping factor — matches resolveMachine default applyMicrostepping:false), inSteps(mm)=int(mm×spmm+0.5), asNativeCoords = dist to motors A(0,0)/B(W,0).
Critical new finding (IN PROGRESS — not yet applied)
Numeric fit of lines.svg → lines.txt (Python, spmm=2.5, W=2900) shows the real controller mapping is:

machine_mm ≈ 0.2443 × rawq_x + 755.76 (x axis)
machine_mm ≈ 0.2451 × rawq_y + 1914.17 (y axis)
where rawq = 0.6401 × (pathPoint + translate(885.7143,0)) (the <g> transform), and t≈0.244 ≈ 0.924 × 25.4/96 → i.e. scale ≈ 0.924 with offsets ≈ (755.76, 1914.17) in mm, NOT the Parameters.scale=0.924, offsetX=742.3, offsetY=1920.7 currently in defaultProperties.json / _js/setupParameters.js.
RMS fit is good (≈0.17–0.20 mm) → the mapping is a clean uniform scale + offset on 96dpi px→mm points.
Immediate next steps (not yet done)
Fix the G-code structure in svg2gcode() to match lines.txt exactly:
Reference per-path structure: C14,END → C17,a0,b0,2,END (first point, pen up) → C13,END → C17,…,2,END (rest) → C14,END.
Current code emits C14 → C13 → C09 (first) → C17… — must change: first move must be C17 (not C09) and pen-down must come after moving to the first point; remove the extra trailing C14 (reference ends with a single C14).
Rounding: integer steps trunc(x+0.5) (already handled by polargraphNative with outputUnit:'steps', quantize:'all', applyMicrostepping:false).
Update the default placement so the default (no explicit settings) matches the controller: scale ≈ 0.924, offsetX ≈ 755.76, offsetY ≈ 1914.17 (verify exact values by re-running the fit; consider whether to change defaultProperties.json + _js/setupParameters.js defaults — user's defaultProperties.json currently has 742.3/1920.7, which was likely from an earlier compareCoords.fitPlacement run).
End-to-end verify against examples/lines.txt: emulate SVGReader in Node (stub returns the rawq points, since SVGReader applies <g transform> via xformToWorld — confirmed in _js/SVGReader.js parseChildren, matrixMult order = matrix(0.6401)×translate(885.7143)), run the real _js/svg2gcode.js svg2gcode() with Parameters (widthMotor 2900, mmPerRev 80, setpsPerRev 200), and diff against lines.txt. A Node test harness pattern already used: stub global.DOMParser, global.SVGReader, eval(fs.readFileSync('_js/svg2gcode.js')).
Files & roles
Path	Role
_js/svg2gcode.js	Target file. svg2gcode() body rewritten (structure still needs C17-first + single trailing C14). Helpers good.
_js/dashBoard.js	Calls svg2gcode(svg, {}, Parameters) from loadSVGFromText/loadSVG. command('goHome') uses polargraphNative+nativeConfigFromParameters.
_js/setupParameters.js	Global Parameters (widthMotor "2900", mmPerRev "80", setpsPerRev "200", microstepping "16", scale 0.924, offsetX 742.3, offsetY 1920.7, pageX/Y, pageWidth/Height).
_js/SVGReader.js	SVG→paths. Applies transforms correctly; returns {allcolors:[[ {x,y} ]]}.
_js/compareCoords.js	Reference/diagnostics (fitPlacement outputs the svg2gcode(svg,{scale,offsetX,offsetY},Parameters) recommendation). Loaded from root via index.html (path fixed to _js/).
C:/Users/Thy/Dev/polargraphcontroller/*.pde	Read-only ground truth: Machine.pde (IK + steps), drawing.pde (C17 = CMD_CHANGELENGTHDIRECT, C13/C14 pen, move flow).
examples/lines.svg, examples/lines.txt	Test input/expected output.
defaultProperties.json	Machine config + placement (scale/offsetX/offsetY).
Constraints / user preferences
Conversion: Cartesian → bipolar (2-motor V-plotter). Pen down = C13, pen up = C14.
Match the Polargraph Controller's exact output for lines.svg.
Steps/mm = stepsPerRev/mmPerRev = 2.5 (microstepping NOT applied) — do not multiply by microstepping in the default path.
Read-only polargraphcontroller folder: view only, never write.
Be concise; cite files with relative links; don't revert user's existing edits.
Open questions / decisions (mine, not user-approved)
I decided the first point uses C17 pen-up (matching lines.txt), replacing my earlier C09.
I decided default placement should be ≈ (0.924, 755.76, 1914.17) per the numeric fit, but the exact offset values and where to store them (vs. keeping user's 742.3/1920.7) should be double-checked against the user's intent before editing defaultProperties.json.