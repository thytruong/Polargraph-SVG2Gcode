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

// Parameters machine et placement (polargraphNative) et filtres pour svg2gcode
var penLiftUp = document.getElementById("penLiftUp");
var penLiftDown = document.getElementById("penLiftDown");
var unitToMM = document.getElementById("unitToMM");
var scale = document.getElementById("scale");
var offsetX = document.getElementById("offsetX");
var offsetY = document.getElementById("offsetY");
var minLineLength = document.getElementById("minLineLength");
var maxSegmentLength = document.getElementById("maxSegmentLength");
var mmPerRevShown = document.getElementById("mmPerRevShown");

// Initialisation des parameters avec les values par default du fichier
var Parameters = {
    machineName: "KultXL XL ",
    widthMotor: "2900",
    widthPX: 10960.62992139,
    heightMotor: "3200",
    xPosition: "1449.81",
    xPositionPX: 5480.314960695,
    yPosition: "2800.19",
    yPositionPX: 10582.67716548,
    mmPerRev: "80.5",
    setpsPerRev: "200",
    microstepping: "16",
    maxSpeed: "6844",
    acceleration: "2028",
    pageWidth: "1560",
    pageHeight: "840",
    pageX: "684",
    pageY: "1903",
    penLiftUp: "90",
    penLiftDown: "180",
    unitToMM: 1,
    scale: 0.246,
    offsetX: 746.94,
    offsetY: 1932.73,
    minLineLength: 2,
    maxSegmentLength: 2
};

// The controller GUI (controlP5 Numberbox, setDecimalPrecision(0)) truncates the label at the
// decimal point : 80.5 is displayed "80" while the machine keeps the float value (80.5).
// sendMachineSpec likewise sends C29 as int(getMMPerRev()) -> 80.
// Geometry (inSteps, stepsPerMM) keeps the true float ; only the display and the C29 sent truncate.
function controllerNumberboxDisplay(value) {
    var s = String(value);
    var dot = s.indexOf('.');
    return (dot === -1) ? s : s.substring(0, dot);
}

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
    Parameters.penLiftUp = penLiftUp.value;
    Parameters.penLiftDown = penLiftDown.value;
    Parameters.unitToMM = unitToMM.value;
    Parameters.scale = scale.value;
    Parameters.offsetX = offsetX.value;
    Parameters.offsetY = offsetY.value;
    Parameters.minLineLength = minLineLength.value;
    Parameters.maxSegmentLength = maxSegmentLength.value;
    if (mmPerRevShown) {
        mmPerRevShown.textContent = controllerNumberboxDisplay(Parameters.mmPerRev);
    }
    console.log("Parameters updated:", Parameters);
};

// Header lines of the controller queue (shared by setParameters and exportGcode).
function machineHeaderLines() {
    // Mirror de la queue de header de controller :
    // preLoadCommandQueue (polargraphcontroller.pde:673, C31 C32 sans C02)
    // + sendMachineSpec (drawing.pde:120, C24 C29 C30 C37 C45, et C31 C32 repeated avec ",1")
    // + sendSetHomePosition (drawing.pde:232, C09 et int(asNativeCoords(homepoint)+0.5))
    var lines = [];
    lines.push("C31," + maxSpeed.value + ",END");
    lines.push("C32," + acceleration.value + ",END");
    lines.push("C24," + widthMotor.value + "," + heightMotor.value + ",END");
    // sendMachineSpec : C29 + int(getMMPerRev()) ; 80.5 stored -> 80 sent
    lines.push("C29," + Math.trunc(parseFloat(mmPerRev.value)) + ",END");
    lines.push("C30," + setpsPerRev.value + ",END");
    lines.push("C37," + microstepping.value + ",END");
    lines.push("C45," + penLiftDown.value + "," + penLiftUp.value + ",1,END");
    lines.push("C31," + maxSpeed.value + ",1,END");
    lines.push("C32," + acceleration.value + ",1,END");
    var home = polargraphNative(parseFloat(xPosition.value), parseFloat(yPosition.value),
                                nativeConfigFromParameters(Parameters));
    if (home) {
        lines.push("C09," + Math.floor(home.a + 0.5) + "," + Math.floor(home.b + 0.5) + ",END");
    } else {
        console.error('setParameters / exportGcode : largeur machine ou home position invalide', Parameters);
    }
    return lines;
}

function setParameters() {
    var gcodeParameters = machineHeaderLines();
    gcodeParameters.push("");
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

// Mapping : keys controller (properties.txt of the controller, cf. XL_KultXL.properties.txt)
// -> keys app Parameters. The controller (geomerative/RG) reads raw SVG user units : unitToMM = 1.
var controllerKeysToParameters = {
    "machine.motors.mmPerRev": "mmPerRev",
    "machine.motors.stepsPerRev": "setpsPerRev",
    "machine.motors.maxSpeed": "maxSpeed",
    "machine.motors.accel": "acceleration",
    "machine.step.multiplier": "microstepping",
    "machine.width": "widthMotor",
    "machine.height": "heightMotor",
    "machine.penlift.up": "penLiftUp",
    "machine.penlift.down": "penLiftDown",
    "controller.homepoint.x": "xPosition",
    "controller.homepoint.y": "yPosition",
    "controller.page.position.x": "pageX",
    "controller.page.position.y": "pageY",
    "controller.page.width": "pageWidth",
    "controller.page.height": "pageHeight",
    "controller.vector.position.x": "offsetX",
    "controller.vector.position.y": "offsetY",
    "controller.vector.minLineLength": "minLineLength",
    "controller.maxSegmentLength": "maxSegmentLength"
};

function controllerPropertiesToParameters(props) {
    var mapped = { unitToMM: 1 };
    for (var key in controllerKeysToParameters) {
        if (props[key] !== undefined) {
            mapped[controllerKeysToParameters[key]] = props[key];
        }
    }
    // controller.vector.scaling pourcent : scaling 24.6 -> scale 0.246 (cf. Machine.pde scaling/100)
    if (props["controller.vector.scaling"] !== undefined) {
        mapped.scale = props["controller.vector.scaling"] / 100;
    }
    return mapped;
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
