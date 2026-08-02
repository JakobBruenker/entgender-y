import {expect} from 'chai';
import {BinnenRegEx} from '../src/replacement';

describe('BinnenRegEx', () => {

    describe('{STERN}', () => {
        // frisches RegExp pro Aufruf, damit kein lastIndex-Zustand stoert
        const stern = () => BinnenRegEx("^{STERN}$");

        it('erkennt alle Trennzeichen, auch den Bindestrich', () => {
            for (const c of [":", "/", "*", "_", "-", "·", "’", "'"]) {
                expect(stern().test(c), `${JSON.stringify(c)} sollte ein Trennzeichen sein`).to.be.true;
            }
        });

        /**
         * Regression: "{STERN}" war als [\:\/\*\_-·’']{1,2} geschrieben.
         * Der unescapte Bindestrich machte aus "\_-·" eine Range von U+005F bis U+00B7,
         * die alle Kleinbuchstaben enthielt - und den Bindestrich selbst gerade nicht.
         */
        it('erkennt keine Buchstaben oder sonstigen Zeichen aus U+005F..U+00B7', () => {
            for (const c of ["a", "m", "z", "{", "|", "}", "~", " ", "°", "`"]) {
                expect(stern().test(c), `${JSON.stringify(c)} darf kein Trennzeichen sein`).to.be.false;
            }
        });

        it('erlaubt maximal zwei Trennzeichen', () => {
            expect(stern().test("/-")).to.be.true;
            expect(stern().test("/-/")).to.be.false;
        });
    });
});
