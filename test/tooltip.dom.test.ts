import {expect} from 'chai';
import {BeGone} from '../src/gendersprachekorrigieren';
import {createParagraph, prepareDocument} from "./domtest-util";
import {BeGoneSettings} from "../src/control/control-api";

beforeEach(() => {
    prepareDocument();
});

const BASE_SETTINGS: BeGoneSettings = {aktiv: true, doppelformen: true, partizip: false, skip_topic: false};

function entgendere(settings: BeGoneSettings, text: string): HTMLElement {
    document.body.appendChild(createParagraph(text));
    new BeGone(undefined, settings).entferneInitial();
    return document.body;
}

function changes(body: HTMLElement): Array<Element> {
    return Array.from(body.querySelectorAll("span.entgendy-change"));
}

describe('Originaltext bei Mouseover', () => {

    it('zeigt den Originaltext als Tooltip, auch ohne Hervorhebung', () => {
        const body = entgendere({...BASE_SETTINGS, tooltip: true}, "Liebe Bürgerinnen und Bürger");

        const spans = changes(body);
        expect(spans.length).to.be.equal(1);
        expect(spans[0].getAttribute("title")).to.be.equal("Bürgerinnen und Bürger");
        // Ohne "hervorheben" soll die Seite optisch unverändert bleiben
        expect(spans[0].getAttribute("style")).to.be.equal("");
        expect(body.textContent!!.trim()).to.be.equal("Liebe Bürgys");
    });

    it('funktioniert zusammen mit der Hervorhebung', () => {
        const body = entgendere({
            ...BASE_SETTINGS,
            tooltip: true,
            hervorheben: true,
            hervorheben_style: "text-decoration: underline wavy blue;"
        }, "Liebe Bürgerinnen und Bürger");

        const spans = changes(body);
        expect(spans.length).to.be.equal(1);
        expect(spans[0].getAttribute("title")).to.be.equal("Bürgerinnen und Bürger");
        expect(spans[0].getAttribute("style")).to.be.equal("text-decoration: underline wavy blue;");
    });

    it('setzt keinen Tooltip, wenn nur hervorgehoben wird', () => {
        const body = entgendere({...BASE_SETTINGS, tooltip: false, hervorheben: true, hervorheben_style: "style-foo"},
            "Liebe Bürgerinnen und Bürger");

        const spans = changes(body);
        expect(spans.length).to.be.equal(1);
        expect(spans[0].hasAttribute("title")).to.be.equal(false);
    });

    it('entgendert genau so viel wie ohne Tooltip (alle Ersetzungsschritte)', () => {
        const text = "Liebe Bürgerinnen und Bürger, die Lehrer*innen und die Student*innen sind da.";
        const erwartet = "Liebe Bürgys, die Lehrys und die Studentys sind da.";

        expect(entgendere({...BASE_SETTINGS}, text).textContent!!.trim()).to.be.equal(erwartet);

        prepareDocument();
        expect(entgendere({...BASE_SETTINGS, tooltip: true}, text).textContent!!.trim()).to.be.equal(erwartet);
    });

    it('verändert das DOM nicht, wenn beide Optionen aus sind', () => {
        const body = entgendere({...BASE_SETTINGS, tooltip: false, hervorheben: false}, "Liebe Bürgerinnen und Bürger");

        expect(changes(body).length).to.be.equal(0);
        expect(body.textContent!!.trim()).to.be.equal("Liebe Bürgys");
    });
});
