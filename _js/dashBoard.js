//all the functions necessery for forms, buttons, cookies 
var svgDiv = document.getElementById("svgDiv");
var gcodeDiv = document.getElementById("gcodeDiv");


function importParameters(event) {
    var input = event.target;
    var reader = new FileReader();

    reader.onload = function () {
        loadParameters(JSON.parse(reader.result));
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

function loadSVG(event) {

    var input = event.target;
    var reader = new FileReader();

    reader.onload = function () {
        svgDiv.value = reader.result;
        gcodeDiv.value += svg2gcode(reader.result, {}, Parameters);
    }
    reader.readAsText(input.files[0]);
}

function loadSVGFromText() {

    var svg = svgDiv.value;
    if (svg !== "") {
        gcodeDiv.value += svg2gcode(svg, {}, Parameters);
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
                gcodeDiv.value += 'C09,' + (+home.a.toFixed(3)) + ',' + (+home.b.toFixed(3)) + ',END\n';
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