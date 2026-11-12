//all the functions necessery for forms, buttons, cookies 
var svgDiv = document.getElementById("svgDiv");
var gcodeDiv = document.getElementById("gcodeDiv");


function importParameters(event) {
    var input = event.target;
    var reader = new FileReader();

    reader.onload = function () {
        var text = reader.result;
        var trimmed = text.trim();
        var parsed;
        try {
            if (/^var\s+defaultProperties\s*=/m.test(trimmed) || trimmed.charAt(0) === "{" || trimmed.charAt(0) === '"') {
                parsed = JSON.parse(trimmed.replace(/^var\s+defaultProperties\s*=\s*/m, ""));
            } else {
                parsed = controllerPropertiesToParameters(parsePropertiesFile(text));
            }
        } catch (err) {
            console.error("importParameters : cannot parse file", err);
            return;
        }
        loadParameters(parsed);
    }
    reader.readAsText(input.files[0]);

}

function saveParameters() {
    var JsonParameters = JSON.stringify(Parameters);
    var toSave = "var defaultProperties = " + JsonParameters;
    var filename = "defaultProperties.json";
    console.log(toSave);
    if (JsonParameters !== "") {
        var blob = new Blob([toSave], {
            type: 'text/csv'
        });
        if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveBlob(blob, filename);
        } else {
            var elem = window.document.createElement('a');
            elem.href = window.URL.createObjectURL(blob);
            elem.download = filename;
            document.body.appendChild(elem);
            elem.click();
            document.body.removeChild(elem);
        }
    }
}

function clearData(linkData) {
    var data = document.getElementById(linkData);
    data.value = "";
}

function loadGcode(event) {
    var input = event.target;
    var reader = new FileReader();

    reader.onload = function () {
        gcodeDiv.value = reader.result;
    }
    reader.readAsText(input.files[0]);
}

function exportSVG() {
    var filename = "modified";
    if (svgDiv.value !== "") {
        var blob = new Blob([svgDiv.value], {
            type: "image/svg+xml;charset=utf-8"
        });
        console.log(blob);
        if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveBlob(blob, filename);
        } else {
            var elem = window.document.createElement('a');
            elem.href = window.URL.createObjectURL(blob);
            elem.download = filename;
            document.body.appendChild(elem);
            elem.click();
            document.body.removeChild(elem);
        }
    }
}

/* ------------------------------------------------------------------ *
 *  Conversion model pour big files (800k paths et +)                   *
 *  The result lives in a JS buffer (conversion), the textarea only     *
 *  mirrors it when it is small enough (GCODE_INLINE_MAX lines) ;        *
 *  otherwise a preview block + stats + Export .txt download (blob       *
 *  built from the buffer directly, never via the textarea).             *
 * ------------------------------------------------------------------ */

var conversion = null;   // { lines: [...], stats: {paths, points, kept} }
var GCODE_INLINE_MAX = 20000;   // lines of gcode max displayed in the textarea

var progressFill = document.getElementById("progressFill");
var progressLabel = document.getElementById("progressLabel");
var svgPreview = document.getElementById("svgPreview");
var conversionStats = document.getElementById("conversionStats");

function setProgress(frac, label) {
    if (progressFill) {
        progressFill.style.width = Math.round(100 * Math.max(0, Math.min(1, frac))) + "%";
    }
    if (progressLabel && label !== undefined) {
        progressLabel.textContent = label;
    }
}

function nextBrowserTick() {
    return new Promise(function (done) { setTimeout(done, 0); });
}

// preview of the uploaded SVG: an <img> around an object URL — the browser
// renders the SVG natively (fast, off our JS loop), independent of path count.
var svgPreviewURL = null;
function updateSVGPreview(svgText) {
    if (!svgPreview) return;
    if (svgPreviewURL !== null) {
        URL.revokeObjectURL(svgPreviewURL);
    }
    var blob = new Blob([svgText], { type: "image/svg+xml" });
    svgPreviewURL = URL.createObjectURL(blob);
    svgPreview.src = svgPreviewURL;
}

// Run the chunked async conversion (progress bar moves, page stays fluid).
async function runConversion(svgText) {
    if (!svgText || svgText === "") {
        return;
    }
    setProgress(0.35, "Parsing SVG (XML, one pass)…");
    await nextBrowserTick();   // let the browser repaint the progress bar first
    setProgress(0.45);
    var result = await svg2gcodeAsync(svgText, {}, Parameters, function (done, total) {
        setProgress(0.45 + 0.55 * (total > 0 ? done / total : 1),
                    "Converting path " + done + " / " + total + "…");
    });
    conversion = result;
    setProgress(1, "Conversion done.");
    updateGcodeView();
    updateStats();
}

function updateGcodeView() {
    if (!conversion) return;
    var lines = conversion.lines;
    if (lines.length === 0) {
        gcodeDiv.value = "";
    } else if (lines.length <= GCODE_INLINE_MAX) {
        gcodeDiv.value = lines.join('\n') + '\n';
    } else {
        // fluidity : don't dump 800k lines in a textarea (it freezes the page)
        var head = lines.slice(0, 40);
        var tail = lines.slice(lines.length - 20);
        gcodeDiv.value =
            ";; PREVIEW ONLY — " + lines.length + " gcode lines not displayed. " +
            "Use the Export .txt button for the full file (machine properties + gcode).\n" +
            head.join('\n') + '\n' +
            ";; [... " + (lines.length - 60) + " lines hidden …]\n" +
            tail.join('\n') + '\n';
    }
}

function updateStats() {
    if (!conversionStats || !conversion) return;
    var st = conversion.stats;
    conversionStats.textContent = "Import : " + st.paths + " paths, " +
        st.points + " points -> " + conversion.lines.length + " gcode lines (" +
        st.kept + " points kept after the min-line filter).";
}

function loadSVG(event) {

    var input = event.target;
    var reader = new FileReader();

    setProgress(0.02, "Reading file…");
    reader.onprogress = function (e) {
        if (e.total > 0) {
            setProgress(0.02 + 0.28 * (e.loaded / e.total), "Reading file…");
        }
    };
    reader.onload = function () {
        var text = reader.result;
        svgDiv.value = text;
        updateSVGPreview(text);
        runConversion(text);
    }
    reader.onerror = function () {
        setProgress(0, "Could not read file.");
    };
    reader.readAsText(input.files[0]);
}

function loadSVGFromText() {

    var svg = svgDiv.value;
    if (svg !== "") {
        updateSVGPreview(svg);
        runConversion(svg);
    }
}

// Export : machine properties header lines + all converted gcode lines, into one
// .txt file. The blob is built from chunk parts (never one giant string) so an
// 800k-path conversion downloads without freezing the tab.
function exportGcode() {
    var parts = [];
    var header = machineHeaderLines();
    parts.push(header.join('\n') + '\n');
    if (conversion && conversion.lines.length > 0) {
        var lines = conversion.lines;
        var CHUNK = 5000;
        for (var i = 0; i < lines.length; i += CHUNK) {
            parts.push(lines.slice(i, i + CHUNK).join('\n'));
            parts.push('\n');
        }
    } else if (gcodeDiv.value !== "") {
        // no conversion stored : fall back to the textarea (hand-built gcode session)
        parts.push(gcodeDiv.value);
    } else {
        console.warn("exportGcode : nothing to export");
        return;
    }
    var base = (Parameters.machineName || "polargraph").trim().replace(/[^A-Za-z0-9_-]+/g, "_");
    var filename = base + "_gcode.txt";
    var blob = new Blob(parts, { type: "text/plain;charset=utf-8" });
    if (window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, filename);
    } else {
        var elem = window.document.createElement('a');
        elem.href = URL.createObjectURL(blob);
        elem.download = filename;
        document.body.appendChild(elem);
        elem.click();
        document.body.removeChild(elem);
    }
}

function exportFile(filename, linkData) {

    var data = document.getElementById(linkData);
    if (data.value !== "") {
        var blob = new Blob([data.value], {
            type: 'text/csv'
        });
        console.log(blob);
        console.log(data);
        if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveBlob(blob, filename);
        } else {
            var elem = window.document.createElement('a');
            elem.href = window.URL.createObjectURL(blob);
            elem.download = filename;
            document.body.appendChild(elem);
            elem.click();
            document.body.removeChild(elem);
        }
    }
}

function px2mm(val) {
    var newMM = val * 0.2646;
    return newMM;
}

function polarX(segmentX, segmentY, convertion = 0) {
    var polarSegmentX = Math.sqrt(Math.pow(segmentX, 2) + Math.pow(segmentY, 2));
    if (convertion == 1) {
        polarSegmentX = px2mm(polarSegmentX) //convertion if neccessary
    }
    polarSegmentX = polarSegmentX.toFixed(0);
    return polarSegmentX;
}

function polarY(segmentX, segmentY, convertion = 0) {
    var polarSegmentY = Math.sqrt(Math.pow(Parameters.widthPX - segmentX, 2) + Math.pow(segmentY, 2));
    if (convertion == 1) {
        polarSegmentY = px2mm(polarSegmentY) //convertion if neccessary
    }
    polarSegmentY = polarSegmentY.toFixed(0);
    return polarSegmentY;
}

function command(event) {
    // PEN_UP_CMD / PEN_DOWN_CMD / polargraphNative / nativeConfigFromParameters viennent de svg2gcode.js
    // (à charger avant ce fichier) : une seule source de vérité pour les commandes stylo et les unités.
    switch (event) {
        case 'penDown':
            gcodeDiv.value += PEN_DOWN_CMD + ',END\n';      // C13
            gcodeDiv.scrollTop = gcodeDiv.scrollHeight;
            break;
        case 'penUp':
            gcodeDiv.value += PEN_UP_CMD + ',END\n';        // C14
            gcodeDiv.scrollTop = gcodeDiv.scrollHeight;
            break;
        case 'goHome': {
            // C09 déclare la position courante (longueurs de fil en PAS), comme Machine.asNativeCoords
            var home = polargraphNative(parseFloat(Parameters.xPosition), parseFloat(Parameters.yPosition),
                                        nativeConfigFromParameters(Parameters));
            if (home) {
                // sendSetHomePosition : int(pgCoords+0.5), no decimals
                gcodeDiv.value += 'C09,' + Math.floor(home.a + 0.5) + ',' + Math.floor(home.b + 0.5) + ',END\n';
                gcodeDiv.scrollTop = gcodeDiv.scrollHeight;
            } else {
                console.error('goHome : largeur machine ou position invalide', Parameters);
            }
            break;
        }
        case 'reset':
            gcodeDiv.value += 'C27,END\n';
            gcodeDiv.scrollTop = gcodeDiv.scrollHeight;
            break;
    }
}