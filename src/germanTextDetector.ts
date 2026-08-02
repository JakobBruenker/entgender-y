/**
 * Günstige Heuristik, ob eine Seite überhaupt deutschen Text enthält.
 *
 * Hintergrund: das Content-Script läuft auf jeder Seite. Ohne diese Prüfung werden auch
 * auf rein englischen Seiten alle Textnodes durchlaufen und Observer installiert -
 * auf reddit.com/r/programming z.B. 1128 Textnodes für garantiert null Ersetzungen.
 *
 * documentElement.lang taugt dafür nicht: reddit meldet auch für r/de "en", weil die
 * Oberfläche englisch ist und nur die Beiträge deutsch sind. Gemessen (Stand 2026-08):
 *
 *   reddit.com/r/de           lang="en"   Stoppwortdichte 8.7%
 *   reddit.com/r/programming  lang="en"   Stoppwortdichte 0.2%
 *
 * Die Dichte trennt die beiden Fälle also um den Faktor 40, das lang-Attribut gar nicht.
 */

const STOPWORDS = new Set(("der die das und ist nicht für mit sich auch werden eine einer einem einen " +
    "dass oder aber von zu zur zum dem den des im ich wir sie es auf bei nach über wie nur noch " +
    "schon man kann muss hat haben wird sind war waren").split(" "));

/** Ab dieser Stoppwortdichte gilt ein Text als deutsch (r/de lag bei 8.7%, r/programming bei 0.2%). */
export const GERMAN_DENSITY_THRESHOLD = 0.04;

/** Unter so vielen Wörtern ist die Dichte zu verrauscht; dann zählt nur noch der Gendermarker. */
const MIN_WORDS = 50;

/** Mehr Wörter braucht die Spracherkennung nicht. Begrenzt die Kosten auf sehr grossen Seiten. */
const MAX_WORDS = 5000;

const WORD = /[a-zA-ZäöüßÄÖÜ]+/g;

/**
 * Eindeutige Gendermarker: Binnen-I, Genderstern, Doppelpunkt, Unterstrich, Mediopunkt.
 *
 * Bewusst eng gefasst, damit englische Texte nicht hängen bleiben. Insbesondere fehlt der
 * Schrägstrich in der Singular-Variante, sonst würde "opt/in" als "Kolleg/in" durchgehen.
 */
const GENDER_MARKER = /[a-zäöüß]{2}(?:[*:_\/·-]innen|Innen|[*:_·]in)\b/;

/**
 * Anteil deutscher Stoppwörter an den (maximal MAX_WORDS) ersten Wörtern.
 */
export function germanStopwordDensity(text: string): { density: number, words: number } {
    WORD.lastIndex = 0;
    let words = 0;
    let hits = 0;
    let match: RegExpExecArray | null;
    while (words < MAX_WORDS && (match = WORD.exec(text)) !== null) {
        words++;
        if (STOPWORDS.has(match[0].toLowerCase())) {
            hits++;
        }
    }
    WORD.lastIndex = 0;
    return {density: words === 0 ? 0 : hits / words, words};
}

export function hasGenderMarker(text: string): boolean {
    return GENDER_MARKER.test(text);
}

/**
 * Ein eindeutiger Gendermarker genügt (eine deutsche Zeile auf einer sonst englischen Seite),
 * sonst entscheidet die Stoppwortdichte.
 */
export function looksGerman(text: string): boolean {
    if (hasGenderMarker(text)) {
        return true;
    }
    const {density, words} = germanStopwordDensity(text);
    return words >= MIN_WORDS && density >= GERMAN_DENSITY_THRESHOLD;
}
