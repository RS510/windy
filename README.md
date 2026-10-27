# Windblick

Wetterkarte nach dem Vorbild von Windy, als Web App für iPhone (und jeden anderen Browser).

## Funktionen

- Animierte Windpartikel auf einer dunklen Weltkarte
- Ebenen: Wind, Böen, Temperatur, Regen, Wolken, Luftdruck mit Isobaren, Luftfeuchte, Wind in 850 und 500 hPa, Wellen, Feinstaub PM2.5, Ozon, Regenradar live
- Zeitleiste über 5 Tage mit Abspielen
- Modellwahl: Auto, ECMWF, GFS, ICON, AROME
- Tippen auf die Karte: Werte an der Stelle, Detailvorhersage über 7 Tage (Meteogramm, Tagestabelle), Modellvergleich, Wellen, Luftqualität
- Ortssuche (auch Koordinaten), eigener Standort, Favoriten
- Spots für Kite, Windsurf, Surf, Segeln mit Wunschwind und Windrichtungen, stündliche Bewertung und beste Zeitfenster
- Einheiten: km/h, m/s, kn, Bft, mph · °C/°F · mm/Zoll · hPa/inHg
- Installierbar auf dem Homescreen, startet auch offline mit zuletzt geladenen Daten

## Auf dem iPhone installieren

1. Link der App in **Safari** öffnen.
2. Unten auf **Teilen** tippen (Quadrat mit Pfeil).
3. **Zum Home Bildschirm** wählen und bestätigen.

## Datenquellen

Open-Meteo (Wettermodelle, Marine, Luftqualität, Ortssuche), RainViewer (Radar), OpenStreetMap / CARTO (Karte). Alle kostenlos ohne Schlüssel, aber nur für private, nicht kommerzielle Nutzung. Für kommerzielle Nutzung ist ein Open-Meteo Abo nötig.

## Entwicklung

```bash
npm install
npm run dev          # Entwicklungsserver
npm test             # Unit Tests
npm run test:e2e     # Browser Tests (alle externen Dienste simuliert)
npm run build        # Produktionsbuild nach dist/
```

Jeder Push auf `main` wird von GitHub Actions getestet und auf GitHub Pages veröffentlicht.
