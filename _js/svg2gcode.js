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
 *   unitToMM            override : mm par SVG user unit. Le controller (geomerative/RG) NOT
 *                       convertit user units — reproduction byte-exact of controller output
 *                       needs unitToMM=1 + scale = controller.vector.scaling/100 (e.g. XL :
 *                       scaling 24.6 → scale 0.246, offsetX/Y = controller.vector.position).
 *   minLineLength       low-pass filter, in steps, compared on NATIVE (A,B) coords — same as
 *                       controller filterPointsLowPass (filterParam =
 *                       controller.vector.minLineLength, XL : 2 ; defaut 0 = filter ditbled).
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
    return { a: applyRounding(n.x, rounding), b: applyRounding(n.y, rounding),
             af: n.x, bf: n.y };   // af/bf : floats pre-rounding (low-pass filter + lift test)
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

/**
 * Convertit un SVG en commandes Polargraph.
 *
 * Contrat de placement (identique à celui recommandé par compareCoords.fitPlacement) :
 *   point machine (mm) = (unité SVG − origine viewBox) × mm/unité × scale + (offsetX, offsetY)
 *
 * `settings` (prioritaire) puis `parameters` :
 *   scale (1) | offsetX, offsetY (0) | maxSegmentLength (2) | decimals (3)
 *   outputUnit | nativeRounding | quantize | applyMicrostepping | penUpCmd | penDownCmd
 *
 * Sortie : C14 (stylo levé) → C13 (stylo posé) → C09 (premier point) puis C17 (mouvements),
 * une séquence C13/C14 par tracé ; coordonnées natives A, B dans l'unité de sortie (pas ou mm).
 */
function svg2gcode(svg, settings, parameters) {
    svg = String(svg).replace(/^[\n\r \t]/gm, '');
    settings = settings || {};
    parameters = parameters || {};

    if (typeof SVGReader === 'undefined' || typeof SVGReader.parse !== 'function') {
        throw new Error('svg2gcode : SVGReader.js doit être chargé avant svg2gcode.js');
    }

    var cfg = nativeConfigFromParameters(parameters, settings);
    var doc = svgDocumentInfo(svg);
    var scale = toNum(pickOption('scale', settings, parameters, 1), 1);
    var offsetX = toNum(pickOption('offsetX', settings, parameters, 0), 0);
    var offsetY = toNum(pickOption('offsetY', settings, parameters, 0), 0);
    var maxSeg = toNum(pickOption('maxSegmentLength', settings, parameters, 2), 2);
    var decimals = toNum(pickOption('decimals', settings, parameters, 3), 3);
    var penUp = String(pickOption('penUpCmd', settings, parameters, PEN_UP_CMD));
    var penDown = String(pickOption('penDownCmd', settings, parameters, PEN_DOWN_CMD));
    // unitToMM override : controller = 1 (reads user units raw, no conversion)
    var unitToMMpick = pickOption('unitToMM', settings, parameters, null);
    var mmPerUnit = (unitToMMpick !== null ? toNum(unitToMMpick, doc.unitToMM) : doc.unitToMM) * scale;
    var minLineLength = toNum(pickOption('minLineLength', settings, parameters, 0), 0);

    // Format de sortie : décimales configurables en mm ; pas entiers sinon (arrondis fait dans polargraphNative)
    function fmt(v) {
        return (cfg.outputUnit === 'mm') ? (+v.toFixed(decimals)).toString() : String(v);
    }

    var parsed = SVGReader.parse(svg, {});
    var paths = parsed.allcolors || [];

    /* Sequence de émission : replica of sendVectorShapes in drawing.pde
     * + filterPointsLowPass (native filter) : per path, if the first point differs from
     * the last emitted, C14 ; then C17 on first point ; then C13 if lifted ; then
     * remaining points C17 ; final C14 at very end. The first point of a path is NOT
     * emitted with C09 — controller always uses CMD_CHANGELENGTHDIRECT (C17).
     * low-pass : keep point j only if |ΔA|>minLineLength OR |ΔB|>minLineLength (native,
     * integer steps) ; path with <2 surviving points emits nothing. */
    var lines = [];
    var lastPoint = { x: 0, y: 0 };   // PVector lastPoint = new PVector()
    for (var i = 0; i < paths.length; i++) {
        var sub = paths[i] || [];
        // phase 1 : all points converted, those outside machine dropped
        var pts = [];
        for (var j = 0; j < sub.length; j++) {
            var p = sub[j];
            if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
            var mx = (p.x - doc.minX) * mmPerUnit + offsetX;
            var my = (p.y - doc.minY) * mmPerUnit + offsetY;
            var n = polargraphNative(mx, my, cfg);
            if (!n) {
                console.warn('svg2gcode : point (' + mx.toFixed(2) + ' ; ' + my.toFixed(2) + ' mm) hors de la machine, ignoré');
                continue;
            }
            pts.push(n);
        }
        // phase 2 : low-pass filter on native coords (like filterPointsLowPass)
        var filtered = [];
        for (var k = 0; k < pts.length; k++) {
            if (filtered.length === 0) { filtered.push(pts[k]); continue; }
            var prev = filtered[filtered.length - 1];
            var diffA = Math.trunc(pts[k].af + 0.5) - Math.trunc(prev.af + 0.5);
            var diffB = Math.trunc(pts[k].bf + 0.5) - Math.trunc(prev.bf + 0.5);
            if (Math.abs(diffA) > minLineLength || Math.abs(diffB) > minLineLength) {
                filtered.push(pts[k]);
            }
        }
        if (filtered.length < 2) continue;   // controller : result.size()<2 → clear ; empty path emits nothing
        var lift = !(filtered[0].af === lastPoint.x && filtered[0].bf === lastPoint.y);
        if (lift) lines.push(penUp + ',END');
        lines.push('C17,' + fmt(filtered[0].a) + ',' + fmt(filtered[0].b) + ',' + maxSeg + ',END');
        if (lift) lines.push(penDown + ',END');
        for (var m = 1; m < filtered.length; m++) {
            lines.push('C17,' + fmt(filtered[m].a) + ',' + fmt(filtered[m].b) + ',' + maxSeg + ',END');
        }
        var lp = filtered[filtered.length - 1];
        lastPoint = { x: lp.af, y: lp.bf };
    }

    if (lines.length === 0) {
        console.warn('svg2gcode : aucun tracé exploitable dans le SVG (pas de C13 émis)');
        return '';
    }
    lines.push(penUp + ',END');
    return lines.join('\n') + '\n';
}
