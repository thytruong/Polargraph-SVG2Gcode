var machineName = document.getElementById("machineName");
var widthMotor = document.getElementById("widthMotor");
var heightMotor = document.getElementById("heightMotor");
var xPosition = document.getElementById("xPosition");
var yPosition = document.getElementById("yPosition");
var mmPerRev = document.getElementById("mmPerRev");
var setpsPerRev = document.getElementById("setpsPerRev");
var microstepping = document.getElementById("microstepping");
var maxSpeed = document.getElementById("maxSpeed");
var acceleration = document.getElementById("acceleration");
var pageWidth = document.getElementById("pageWidth");
var pageHeight = document.getElementById("pageHeight");
var pageX = document.getElementById("pageX");
var pageY = document.getElementById("pageY");

// Initialisation des paramètres avec les valeurs par défaut du fichier
var Parameters = {
    machineName: "KultXL XL ",
    widthMotor: "2900",
    widthPX: 10960.62992139,
    heightMotor: "3200",
    xPosition: "1450",
    xPositionPX: 5480.314960695,
    yPosition: "2800",
    yPositionPX: 10582.67716548,
    mmPerRev: "80",
    setpsPerRev: "200",
    microstepping: "16",
    maxSpeed: "6844",
    acceleration: "2028",
    pageWidth: "1560",
    pageHeight: "840",
    pageX: "684",
    pageY: "1903",
    scale: 0.924,
    offsetX: 742.3,
    offsetY: 1920.7
};

function updateParameters() {
    Parameters.machineName = machineName.value;
    Parameters.widthMotor = widthMotor.value;
    Parameters.widthPX = (Parameters.widthMotor ? Parameters.widthMotor * 3.7795275591 : 10960.63);
    Parameters.heightMotor = heightMotor.value;
    Parameters.xPosition = xPosition.value;
    Parameters.xPositionPX = (Parameters.xPosition ? Parameters.xPosition * 3.7795275591 : 5480.31);
    Parameters.yPosition = yPosition.value;
    Parameters.yPositionPX = (Parameters.yPosition ? Parameters.yPosition * 3.7795275591 : 10582.68);
    Parameters.mmPerRev = mmPerRev.value;
    Parameters.setpsPerRev = setpsPerRev.value;
    Parameters.microstepping = microstepping.value;
    Parameters.maxSpeed = maxSpeed.value;
    Parameters.acceleration = acceleration.value;
    Parameters.pageWidth = pageWidth.value;
    Parameters.pageHeight = pageHeight.value;
    Parameters.pageX = pageX.value;
    Parameters.pageY = pageY.value;
    console.log("Parameters updated:", Parameters);
};

function setParameters() {
    var gcodeParameters = [];
    gcodeParameters.push(["C24," + widthMotor.value + "," + heightMotor.value + ",END"]);
    gcodeParameters.push(["C29," + mmPerRev.value + ",END"]);
    gcodeParameters.push(["C30," + setpsPerRev.value + ",END"]);
    gcodeParameters.push(["C31," + maxSpeed.value + ",END"]);
    gcodeParameters.push(["C32," + acceleration.value + ",END"]);
    gcodeParameters.push(["C37," + microstepping.value + ",END"]);
    gcodeParameters.push([""]);
    console.log(gcodeParameters);
    gcodeDiv.value += gcodeParameters.join('\n');
};

function parsePropertiesFile(content) {
    var props = {};
    var lines = content.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line === "" || line.startsWith("#")) continue;
        var parts = line.split("=");
        if (parts.length >= 2) {
            var key = parts[0].trim();
            var val = parts.slice(1).join("=").trim();
            if (!isNaN(val) && val !== "") {
                props[key] = parseFloat(val);
            } else {
                props[key] = val;
            }
        }
    }
    return props;
}

function loadParameters(newParameters) {
    if (newParameters) {
        var Copie = Object.assign(Parameters, newParameters);
        for (var key in Copie) {
            if (document.getElementById(key) !== null) {
                document.getElementById(key).value = Copie[key];
            }
        }
    }
    updateParameters();
    console.log("Parameters loaded:", Parameters);
}

// Initial load
if (typeof defaultProperties !== 'undefined') {
    loadParameters(defaultProperties);
} else {
    updateParameters();
}
