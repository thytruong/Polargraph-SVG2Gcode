/**
 * svg2gcode.js — SVG → commandes Polargraph (traceuse pendulaire)
 *
 * Géométrie de référence : Machine.pde (Polargraph Controller)
 *
 *   moteur A = (0, 0)        moteur B = (W, 0)        y positif vers le bas
 *
 *   asNativeCoords    :  A = dist(0,0, x,y)      B = dist(W,0, x,y)
 *   asCartesianCoords :  x = (W² − B² + A²) / 2W ;  y = √(A² − x²)
 *
 * Attention : Machine.pde travaille en PAS (setSize(inSteps(mm)), inSteps = mm × stepsPerMM + 0,5
 * tronqué), pas en millimètres. Les commandes C09 / C17 du firmware Polargraph attendent
 * des longueurs en pas. Voir `outputUnit` ci-dessous pour rester en mm si votre firmware l'exige.
 *
 * Options (lues dans `settings` puis dans `parameters`) :
 *   outputUnit          'steps' (défaut) | 'mm'
 *   nativeRounding      'round' (défaut) | 'trunc' | 'none'      (sortie en pas uniquement)
 *   quantize            'all' (défaut) | 'width' | 'none'        'all' = comme Machine.pde : largeur ET points
 *                       cartésiens arrondis en pas entiers avant le calcul (validé sur la référence : 24/24)
 *   applyMicrostepping  false (défaut) | true   (pas/mm = stepsPerRev × microstepping / mmPerRev)
 *   offsetX, offsetY    position (mm) de l'origine du SVG dans le repère machine
 *                       (origine = moteur A, y vers le bas). Défaut : X centré, Y = 0.
 *   scale               facteur d'agrandissement supplémentaire (défaut 1)
 *   maxSegmentLength    4e paramètre de C17 (défaut 2)
 *   decimals            décimales si outputUnit = 'mm' (défaut 3)
 *   penUpCmd / penDownCmd   défaut C14 / C13  (firmware : C13 = stylo posé, C14 = stylo levé)
 */

var PX_TO_MM = 25.4 / 96;      // 1 px CSS = 0,264583… mm (dashBoard.js utilisait 0,2646 ; SVGReader 90 dpi)

var PEN_DOWN_CMD = 'C13';      // firmware : C13 = stylo posé
var PEN_UP_CMD = 'C14';        //            C14 = stylo levé   (utilisé aussi par dashBoard.js)


/* ------------------------------------------------------------------ */
/*  Utilitaires                                                        */
/* ------------------------------------------------------------------ */

function toNum(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
}

function toBool(v) {
    return v === true || v === 'true' || v === 1 || v === '1';
}

function pickOption(key, settings, parameters, def) {
    var s = settings && settings[key];
    if (s !== undefined && s !== null && s !== '') return s;
    var p = parameters && parameters[key];
    if (p !== undefined && p !== null && p !== '') return p;
    return def;
}

/** Machine.pde : inSteps() = (int)(mm × stepsPerMM + 0.5) */
function inSteps(mm, stepsPerMM) {
    return Math.trunc(mm * stepsPerMM + 0.5);
}

function applyRounding(v, mode) {
    if (mode === 'none') return v;
    if (mode === 'trunc') return Math.trunc(v);
    return Math.trunc(v + 0.5);                       // 'round' (identique à inSteps)
}


/* ------------------------------------------------------------------ */
/*  Géométrie pure (équivalents de Machine.pde)                        */
/* ------------------------------------------------------------------ */

/**
 * Machine.pde : asNativeCoords.
 * cartX, cartY et machineWidth doivent être dans la MÊME unité ; le résultat l'est aussi.
 * Retourne null si une entrée est invalide (l'ancienne version renvoyait {0,0} ou
 * calculait avec W = 0, ce qui donnait A = B partout).
 */
function calculateNativeCoords(cartX, cartY, machineWidth /*, machineHeight (inutile ici) */) {
    if (!isFinite(cartX) || !isFinite(cartY) || !isFinite(machineWidth) || machineWidth <= 0) {
        return null;
    }
    var dxB = cartX - machineWidth;
    return {
        x: Math.sqrt(cartX * cartX + cartY * cartY),   // distance moteur A (0,0)
        y: Math.sqrt(dxB * dxB + cartY * cartY)        // distance moteur B (W,0)
    };
}

/**
 * Machine.pde : asCartesianCoords (inverse). `truncate = true` reproduit les int()
 * de l'original (x tronqué, puis y calculé à partir du x tronqué, puis tronqué).
 */
function calculateCartesianCoords(nativeA, nativeB, machineWidth, truncate) {
    var W = machineWidth;
    var x = (W * W - nativeB * nativeB + nativeA * nativeA) / (2 * W);
    if (truncate) x = Math.trunc(x);
    var y = Math.sqrt(Math.max(0, nativeA * nativeA - x * x));
    if (truncate) y = Math.trunc(y);
    return { x: x, y: y };
}


/* ------------------------------------------------------------------ */
/*  Configuration machine                                              */
/* ------------------------------------------------------------------ */

/**
 * Lit les noms réellement présents dans `Parameters` (setupParameters.js) :
 * widthMotor, heightMotor, mmPerRev, setpsPerRev (sic), microstepping.
 * Accepte aussi machineWidth / machineHeight / stepsPerRev.
 */
function resolveMachine(parameters, options) {
    var p = parameters || {};
    var o = options || {};
    var widthMM = toNum(p.widthMotor, toNum(p.machineWidth, NaN));
    if (!(widthMM > 0)) {
        throw new Error('svg2gcode : largeur machine introuvable (widthMotor / machineWidth) — ' +
                        'sans elle les deux longueurs de fil seraient identiques.');
    }
    var mmPerRev = toNum(p.mmPerRev, 95);
    var stepsPerRev = toNum(p.setpsPerRev, toNum(p.stepsPerRev, 200));
    var microstepping = toNum(p.microstepping, 1);
    var applyMicro = (o.applyMicrostepping !== undefined) ? toBool(o.applyMicrostepping)
                                                          : toBool(p.applyMicrostepping);
    return {
        widthMM: widthMM,
        heightMM: toNum(p.heightMotor, toNum(p.machineHeight, NaN)),
        mmPerRev: mmPerRev,
        stepsPerRev: stepsPerRev,
        microstepping: microstepping,
        applyMicrostepping: applyMicro,
        stepsPerMM: (stepsPerRev * (applyMicro ? microstepping : 1)) / mmPerRev
    };
}

/**
 * Construit la config de calcul à partir de `Parameters` (+ options éventuelles).
 * Partagée par svg2gcode et par les boutons du dashboard (goHome), pour qu'ils
 * utilisent exactement les mêmes unités et arrondis.
 */
function nativeConfigFromParameters(parameters, settings) {
    settings = settings || {};
    parameters = parameters || {};
    var machine = resolveMachine(parameters, {
        applyMicrostepping: pickOption('applyMicrostepping', settings, parameters, false)
    });
    var outputUnit = String(pickOption('outputUnit', settings, parameters, 'steps'));
    return {
        widthMM: machine.widthMM,
        stepsPerMM: machine.stepsPerMM,
        inputUnit: 'mm',
        outputUnit: outputUnit,
        rounding: (outputUnit === 'steps') ? String(pickOption('nativeRounding', settings, parameters, 'round')) : 'none',
        quantize: String(pickOption('quantize', settings, parameters, 'all'))
    };
}

/**
 * Point d'entrée unique du calcul (utilisé par svg2gcode ET par compareCoords.js).
 * cfg : { widthMM, stepsPerMM, inputUnit:'mm'|'px'|'steps', outputUnit:'steps'|'mm',
 *         rounding:'round'|'trunc'|'none', quantize:'width'|'all'|'none' }
 */
function polargraphNative(xIn, yIn, cfg) {
    var spmm = cfg.stepsPerMM;
    var inputUnit = cfg.inputUnit || 'mm';
    var outputUnit = cfg.outputUnit || 'steps';
    var rounding = cfg.rounding || 'round';
    var quantize = cfg.quantize || 'all';
    var toSteps = (outputUnit === 'steps');

    // facteur  unité d'entrée → unité de calcul (= unité de sortie)
    var inToMM = (inputUnit === 'px') ? PX_TO_MM : (inputUnit === 'steps' ? 1 / spmm : 1);
    var factor = (inputUnit === outputUnit) ? 1 : inToMM * (toSteps ? spmm : 1);

    var x = xIn * factor;
    var y = yIn * factor;
    var W = cfg.widthMM * (toSteps ? spmm : 1);

    if (toSteps) {
        if (quantize === 'width' || quantize === 'all') W = inSteps(cfg.widthMM, spmm);
        if (quantize === 'all') { x = Math.trunc(x + 0.5); y = Math.trunc(y + 0.5); }
    }

    var n = calculateNativeCoords(x, y, W);
    if (!n) return null;
    return { a: applyRounding(n.x, rounding), b: applyRounding(n.y, rounding) };
}


/* ------------------------------------------------------------------ */
/*  Unités du SVG                                                      */
/* ------------------------------------------------------------------ */

/** Convertit une longueur CSS ("210mm", "96", "8.5in"…) en mm ; null si inconnue (%, em…). */
function parseLengthToMM(str) {
    if (str === null || str === undefined) return null;
    var m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(String(str));
    if (!m) return null;
    var f = { '': PX_TO_MM, 'px': PX_TO_MM, 'mm': 1, 'cm': 10, 'in': 25.4,
              'pt': 25.4 / 72, 'pc': 25.4 / 6 }[m[2].toLowerCase()];
    return (f === undefined) ? null : parseFloat(m[1]) * f;
}

/**
 * SVGReader ignore width / height / viewBox de la balise <svg> racine (code commenté) : ses
 * coordonnées sont des « unités utilisateur » brutes. Il faut donc retrouver ici ce que vaut
 * une unité utilisateur en mm, sinon un SVG en mm (Inkscape) est réduit d'un facteur 3,78.
 */
function svgDocumentInfo(svgString) {
    var info = { unitToMM: PX_TO_MM, minX: 0, minY: 0, widthMM: null, heightMM: null,
                 source: '1 unité = 1 px (96 dpi) par défaut' };
    try {
        var root = new DOMParser().parseFromString(svgString, 'text/xml').documentElement;
        var wMM = parseLengthToMM(root.getAttribute('width'));
        var hMM = parseLengthToMM(root.getAttribute('height'));
        var vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);

        if (vb.length === 4 && vb.every(function (v) { return isFinite(v); }) && vb[2] > 0 && vb[3] > 0) {
            var sx = (wMM !== null) ? wMM / vb[2] : null;
            var sy = (hMM !== null) ? hMM / vb[3] : null;
            var s = (sx !== null && sy !== null) ? Math.min(sx, sy) : (sx !== null ? sx : sy);
            if (s !== null) {
                info.unitToMM = s;
                info.source = 'viewBox + width/height';
            } else {
                info.source = 'viewBox sans width/height : 1 unité = 1 px';
            }
            info.minX = vb[0];
            info.minY = vb[1];
            info.widthMM = vb[2] * info.unitToMM;
            info.heightMM = vb[3] * info.unitToMM;
        } else if (wMM !== null || hMM !== null) {
            info.widthMM = wMM;
            info.heightMM = hMM;
            info.source = 'width/height sans viewBox : 1 unité = 1 px';
        }
    } catch (e) {
        console.warn('svgDocumentInfo : lecture du <svg> impossible, 1 unité = 1 px', e);
    }
    return info;
}


/* ------------------------------------------------------------------ */
/*  Conversion SVG → G-code                                            */
/* ------------------------------------------------------------------ */

function svg2gcode(svg, settings, parameters) {
    svg = svg.replace(/^[\n\r \t]/gm, '');
    settings = settings || {};
    parameters = parameters || {};

    var cfg = nativeConfigFromParameters(parameters, settings);
    var machine = { widthMM: cfg.widthMM, stepsPerMM: cfg.stepsPerMM };
    var outputUnit = cfg.outputUnit;
    var maxSeg = pickOption('maxSegmentLength', settings, parameters, 2);
    var decimals = toNum(pickOption('decimals', settings, parameters, 3), 3);
    var userScale = toNum(pickOption('scale', settings, parameters, 1), 1);
    var penUp = String(pickOption('penUpCmd', settings, parameters, PEN_UP_CMD));
    var penDown = String(pickOption('penDownCmd', settings, parameters, PEN_DOWN_CMD));

    // --- unités et placement ------------------------------------------------
    var doc = svgDocumentInfo(svg);
    var mmPerUnit = doc.unitToMM * userScale;

    var offsetX = toNum(pickOption('offsetX', settings, parameters, NaN), NaN);
    var offsetY = toNum(pickOption('offsetY', settings, parameters, NaN), NaN);
    if (!isFinite(offsetX)) {
        offsetX = (doc.widthMM !== null) ? (machine.widthMM - doc.widthMM * userScale) / 2 : 0;
    }
    if (!isFinite(offsetY)) {
        offsetY = 0;
        console.warn('svg2gcode : offsetY non défini → origine du dessin placée sur la ligne des moteurs (y = 0).');
    }

    function fmt(v) {
        return (outputUnit === 'steps') ? String(v) : String(+v.toFixed(decimals));
    }
    function moveCmd(n) {
        return ['C17', fmt(n.a), fmt(n.b), maxSeg, 'END'].join(',');
    }

    // --- lecture des tracés -------------------------------------------------
    var parsed = SVGReader.parse(svg, {});
    var paths = parsed.allcolors || [];
    var gcode = [];
    var report = { unitSource: doc.source, mmPerUnit: mmPerUnit, offsetX: offsetX, offsetY: offsetY,
                   outputUnit: outputUnit, stepsPerMM: machine.stepsPerMM, widthMM: machine.widthMM,
                   paths: 0, points: 0, duplicatesSkipped: 0, outOfZone: 0, invalid: 0 };

    // --- position de départ (le stylo est physiquement au « home » du dashboard) ---
    var homeX = toNum(parameters.xPosition, NaN);
    var homeY = toNum(parameters.yPosition, NaN);
    var home = (isFinite(homeX) && isFinite(homeY)) ? polargraphNative(homeX, homeY, cfg) : null;
    if (home) gcode.push(['C09', fmt(home.a), fmt(home.b), 'END'].join(','));

    gcode.push(penUp + ',END');

    for (var pathIdx = 0; pathIdx < paths.length; pathIdx++) {
        var path = paths[pathIdx];
        if (!path || path.length === 0) continue;

        var pts = [];
        var prev = null;
        for (var i = 0; i < path.length; i++) {
            var xmm = (path[i].x - doc.minX) * mmPerUnit + offsetX;
            var ymm = (path[i].y - doc.minY) * mmPerUnit + offsetY;
            if (xmm < 0 || xmm > machine.widthMM || ymm <= 0) report.outOfZone++;

            var n = polargraphNative(xmm, ymm, cfg);
            if (!n) { report.invalid++; continue; }
            if (prev && n.a === prev.a && n.b === prev.b) { report.duplicatesSkipped++; continue; }
            pts.push(n);
            prev = n;
        }
        if (pts.length < 2) continue;                    // tracé dégénéré : rien à dessiner

        gcode.push(moveCmd(pts[0]));                     // stylo levé → premier point
        gcode.push(penDown + ',END');                    // stylo posé
        for (var j = 1; j < pts.length; j++) gcode.push(moveCmd(pts[j]));
        gcode.push(penUp + ',END');                      // stylo levé

        report.paths++;
        report.points += pts.length;
    }

    if (home) gcode.push(moveCmd(home));                 // retour au home (stylo levé)

    if (report.outOfZone > 0) {
        console.warn('svg2gcode : ' + report.outOfZone + ' point(s) hors de la zone [0 ; ' +
                     machine.widthMM + '] mm en X ou au-dessus des moteurs. Ajustez offsetX / offsetY / scale.');
    }
    svg2gcode.lastReport = report;                       // inspectable dans la console
    return gcode.join('\n');
}


if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        svg2gcode: svg2gcode, calculateNativeCoords: calculateNativeCoords,
        calculateCartesianCoords: calculateCartesianCoords, polargraphNative: polargraphNative,
        resolveMachine: resolveMachine, nativeConfigFromParameters: nativeConfigFromParameters, inSteps: inSteps, svgDocumentInfo: svgDocumentInfo,
        parseLengthToMM: parseLengthToMM, PX_TO_MM: PX_TO_MM
    };
}