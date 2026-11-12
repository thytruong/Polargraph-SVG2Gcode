# Conversion cartésien → longueurs de courroie

## Le principe

Sur une traceuse murale (polargraph / V-plotter), le stylo n'a pas de moteur qui le déplace en X et Y. Sa position est entièrement déterminée par **deux longueurs de fil (ou de courroie)** : celle qui va vers le moteur gauche et celle qui va vers le moteur droit. Les moteurs ne savent donc pas "aller en (x, y)". Ils savent seulement "dérouler ou enrouler jusqu'à la longueur L".

## 1. Cartésien → longueurs (cinématique inverse)

On place l'origine sur le moteur gauche, avec x vers la droite et y vers le bas. Le moteur droit est en (W, 0), où W est la distance entre les deux poulies. Le stylo est en (x, y).

Chaque fil forme l'hypoténuse d'un triangle rectangle, donc Pythagore suffit :

```
L1 = √(x² + y²)            (fil gauche)
L2 = √((W − x)² + y²)      (fil droit)
```

C'est tout pour le sens utile au dessin. Chaque point (x, y) du dessin donne un couple (L1, L2) unique.

## 2. Longueurs → pas moteur

Il faut ensuite convertir des mm de fil en pas de moteur :

```
pas_par_mm = (pas_par_tour × microstepping) / (circonférence de la poulie)
```

Exemple avec un NEMA 17 à 200 pas/tour, un microstepping 1/16 et une poulie GT2 de 20 dents (pas de 2 mm, soit 40 mm par tour) :

```
pas_par_mm = (200 × 16) / 40 = 80 pas/mm   →   0,0125 mm/pas
```

La cible de chaque moteur est alors `pas = L × pas_par_mm`. En pratique, on travaille en différence par rapport à la position actuelle (ΔL1, ΔL2).

## 3. Le sens inverse (utile pour le homing)

Au démarrage, le stylo est à une position connue, ou on connaît directement L1 et L2. Pour retrouver (x, y) à partir des longueurs :

```
x = (L1² − L2² + W²) / (2W)
y = √(L1² − x²)
```

## 4. Le piège principal : les lignes droites

La relation entre (x, y) et (L1, L2) n'est **pas linéaire**. Si on convertit seulement le point de départ et le point d'arrivée d'un segment, puis qu'on fait avancer les deux moteurs proportionnellement, le stylo trace une **courbe** et non une droite.

Il faut donc **découper chaque segment en petits morceaux** (typiquement 0,5 à 2 mm) et convertir chaque point intermédiaire. Sur un segment court, la courbe est indiscernable d'une droite.

```python
def segmenter(p0, p1, pas_mm=1.0):
    n = max(1, int(dist(p0, p1) / pas_mm))
    for i in range(1, n + 1):
        t = i / n
        x = p0.x + t * (p1.x - p0.x)
        y = p0.y + t * (p1.y - p0.y)
        yield (x, y)

for (x, y) in segmenter(prev, target):
    L1 = hypot(x, y)
    L2 = hypot(W - x, y)
    deplacer_moteurs(L1 * pas_par_mm, L2 * pas_par_mm)
```

Pour une vitesse constante au stylo, la vitesse de chaque moteur doit être recalculée à chaque mini-segment, car le rapport ΔL/Δdistance change selon la position.

## 5. Les effets à connaître

- **Précision variable** : la résolution n'est pas uniforme sur la surface. Elle est bonne au centre, et se dégrade là où les deux fils deviennent presque parallèles (stylo très bas au milieu, mal conditionné en x) ou presque alignés avec la ligne des moteurs (stylo très haut, mal conditionné en y). On évite en général de dessiner trop près du haut.
- **Rayon des poulies** : le fil quitte la poulie en tangente, pas depuis son centre. Pour un travail précis, on compense en considérant le point d'ancrage effectif plutôt que le centre de l'axe. C'est négligeable avec de petites poulies, mais visible avec de grosses.
- **Enroulement sur bobine** : avec un fil qui s'enroule sur un tambour, le diamètre effectif change au fil des couches. Avec une courroie crantée sur poulie (le cas le plus courant), la relation reste constante, ce qui est plus simple.
- **Poids et élasticité** : le poids de la nacelle et l'étirement de la courroie introduisent des erreurs de quelques dixièmes de mm, qu'on corrige avec un étalonnage (mesure de W et de la position initiale).

Si tu veux, je peux te faire un schéma de la géométrie ou détailler la compensation du rayon de poulie.