import {expect} from 'chai';
import {BeGone} from '../src/gendersprachekorrigieren';
import {createParagraph, prepareDocument} from './domtest-util';
import {BeGoneSettings} from '../src/control/control-api';

const SETTINGS: BeGoneSettings = {aktiv: true, doppelformen: true, partizip: false, skip_topic: false};

function seiteMit(text: string, settings: BeGoneSettings = SETTINGS): string {
    prepareDocument();
    document.body.appendChild(createParagraph(text));
    new BeGone().handleResponse({response: JSON.stringify(settings)});
    return document.body.textContent!!.trim();
}

const DEUTSCH_GEGENDERT = `Liebe Bürgerinnen und Bürger, die Lehrer*innen und die Student*innen der
Stadt haben sich gestern getroffen, um über die neuen Regeln zu sprechen. Es ist noch nicht klar,
ob die Vorschläge von allen mitgetragen werden, aber die Richtung ist schon jetzt erkennbar.`;

// Enthält "opt/in" - das wird von den Regeln faelschlich als "Kolleg/in" gelesen und zu "opty".
// Die Spracherkennung soll genau das verhindern, indem die Seite gar nicht erst angefasst wird.
const ENGLISCH_MIT_FALLE = `Users can opt/in to the newsletter at any time from the account page.
The president said on Monday that the new policy would take effect in January. Many economists
disagree with the assessment, arguing that inflation remains the main concern for households
across the country. Please note the change and see the guide for details before you continue.`;

describe('Spracherkennung im Ablauf', () => {

    it('entgendert eine deutsche Seite', () => {
        const out = seiteMit(DEUTSCH_GEGENDERT);
        expect(out).to.contain("Bürgys");
        expect(out).to.contain("Lehrys");
        expect(out).to.not.contain("Bürgerinnen und Bürger");
    });

    it('fasst eine englische Seite gar nicht erst an', () => {
        const out = seiteMit(ENGLISCH_MIT_FALLE);
        expect(out).to.be.equal(ENGLISCH_MIT_FALLE.trim());
        expect(out, 'ohne Spracherkennung wuerde hier "opty" stehen').to.contain("opt/in");
    });

    it('läuft bei "Bei Bedarf" trotzdem, weil der Nutzer es explizit will', () => {
        prepareDocument();
        document.body.appendChild(createParagraph(ENGLISCH_MIT_FALLE));
        new BeGone().handleResponse({
            response: JSON.stringify({...SETTINGS, aktiv: false, filterliste: "Bei Bedarf"}),
            type: "ondemand"
        });
        // Klick aufs Icon umgeht die Spracherkennung - dann schlaegt der Fehlalarm wieder zu.
        expect(document.body.textContent!!).to.contain("opty");
    });
});
