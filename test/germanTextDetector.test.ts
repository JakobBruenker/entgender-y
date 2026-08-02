import {expect} from 'chai';
import {germanStopwordDensity, hasGenderMarker, looksGerman} from '../src/germanTextDetector';

const DEUTSCH = `Die Bundesregierung hat am Montag mitgeteilt, dass die neuen Regeln im Januar in Kraft
treten. Viele Fachleute sind mit der Einschätzung nicht einverstanden und argumentieren, dass die
Inflation weiterhin die grösste Sorge für die Haushalte im ganzen Land ist. Der Bericht wurde von
einem Institut erstellt, das sich seit Jahren mit dem Thema beschäftigt. Es kann sein, dass die
Zahlen noch angepasst werden, aber die Richtung ist schon jetzt klar erkennbar.`;

const ENGLISCH = `The president said on Monday that the new policy would take effect in January. Many
economists disagree with the assessment, arguing that inflation remains the main concern for
households across the country. The report was produced by an institute that has worked on the topic
for years. The numbers may still be adjusted, but the direction is already clear. Please note the
change and see the guide for details before you continue with the next section of this document.`;

// r/de: englische Oberfläche, deutsche Beiträge. Gemessen: lang="en", Dichte 8.7%.
const REDDIT_DE = `Home Popular All Random Users AskReddit Log In Sign Up Search Reddit
Posted by u/someuser 4 hours ago 127 comments share save hide report
Warum ist die Bahn eigentlich immer so unpünktlich? Ich habe gestern wieder zwei Stunden gewartet
und niemand konnte mir sagen, wann der Zug denn nun kommt. Das ist doch nicht mehr normal.
Posted by u/anotheruser 7 hours ago 43 comments share save hide report
Neue Studie zu Raucher:innen in Deutschland zeigt, dass die Zahl seit Jahren zurückgeht.
Die Forschenden haben dafür Daten von über zehntausend Personen ausgewertet.
Vote Reply Give Award Share Report Save Follow About Community Moderators Rules`;

// r/programming: gleiche Oberfläche, englische Beiträge. Gemessen: lang="en", Dichte 0.2%.
const REDDIT_PROGRAMMING = `Home Popular All Random Users AskReddit Log In Sign Up Search Reddit
Posted by u/someuser 4 hours ago 127 comments share save hide report
Why is dependency management still so painful in 2026? I spent two hours yesterday waiting for a
build and nobody could tell me why the cache kept getting invalidated. This should not be normal.
Posted by u/anotheruser 7 hours ago 43 comments share save hide report
A new study of static analysis tools shows that adoption has been growing steadily for years.
The researchers evaluated data from more than ten thousand repositories.
Vote Reply Give Award Share Report Save Follow About Community Moderators Rules`;

describe('Spracherkennung', () => {

    describe('looksGerman', () => {
        it('erkennt deutschen Text', () => {
            expect(looksGerman(DEUTSCH)).to.be.true;
        });

        it('erkennt englischen Text nicht als deutsch', () => {
            expect(looksGerman(ENGLISCH)).to.be.false;
        });

        it('erkennt deutsche Beiträge auf englischer Oberfläche (r/de)', () => {
            expect(looksGerman(REDDIT_DE)).to.be.true;
        });

        it('überspringt die gleiche Oberfläche mit englischen Beiträgen (r/programming)', () => {
            expect(looksGerman(REDDIT_PROGRAMMING)).to.be.false;
        });

        it('nimmt einen eindeutigen Gendermarker auch ohne deutschen Kontext', () => {
            expect(looksGerman("Some english page that happens to mention Bürger*innen once.")).to.be.true;
        });

        it('ist bei sehr kurzen Texten ohne Marker zurückhaltend', () => {
            expect(looksGerman("Der Hund ist da.")).to.be.false;
            expect(looksGerman("")).to.be.false;
        });
    });

    describe('germanStopwordDensity', () => {
        it('trennt deutsch und englisch deutlich', () => {
            const de = germanStopwordDensity(REDDIT_DE);
            const en = germanStopwordDensity(REDDIT_PROGRAMMING);
            expect(de.density, `deutsch war ${(de.density * 100).toFixed(1)}%`).to.be.greaterThan(0.04);
            expect(en.density, `englisch war ${(en.density * 100).toFixed(1)}%`).to.be.lessThan(0.04);
        });

        it('zählt leeren Text als 0', () => {
            expect(germanStopwordDensity("").density).to.be.equal(0);
        });
    });

    describe('hasGenderMarker', () => {
        it('erkennt die üblichen Schreibweisen', () => {
            for (const s of ["Raucher:innen", "Bürger*innen", "Lehrer_innen", "LehrerInnen",
                             "Kolleg*in", "Leser/innen", "Mitarbeiter·innen"]) {
                expect(hasGenderMarker(s), s).to.be.true;
            }
        });

        it('bleibt bei englischen Wörtern ruhig', () => {
            for (const s of ["opt/in", "opt-in", "built-in", "check-in", "and/or", "his/her",
                             "e.g. the manager", "src/main", "LinkedIn", "sign in to your account"]) {
                expect(hasGenderMarker(s), s).to.be.false;
            }
        });
    });
});
