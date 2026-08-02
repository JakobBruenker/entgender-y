import {Replacement} from './replacement'
import {Phettberg} from './schreibalternativen/phettberg';
import {
    BeGoneSettings,
    CountRequest,
    ErrorRequest,
    NeedOptionsRequest,
    Response,
    ResponseType
} from "./control/control-api";
import {SchreibAlternative} from "./schreibalternativen/alternative";
import {ChangeHighlighter} from "./ChangeHighlighter";
import {ChangeAllowedChecker} from "./changeAllowedChecker";
import {ifDebugging, stackToBeGone} from "./logUtil";
import {
    SuperPowerfulMutationObserver,
    superPowerfulTextContentOf,
    SuperPowerfulTreeWalker
} from "./superPowerfulDOMSearcher";
import {looksGerman} from "./germanTextDetector";

/** Entprellung der wiederholten Spracherkennung auf SPAs. */
const LANGUAGE_RECHECK_DELAY_MS = 2000;

export function urlFilterListToRegex(list: string | undefined): RegExp {
    return RegExp(list ? list.replace(/(\r\n|\n|\r)/gm, "|") : "");
}

class BeGoneSettingsHelper {
    public static isWhitelist(settings: BeGoneSettings): boolean {
        return settings.filterliste === "Whitelist";
    }

    public static isBlacklist(settings: BeGoneSettings): boolean {
        return settings.filterliste === "Blacklist";
    }

    public static whitelistRegexp(settings: BeGoneSettings): RegExp {
        try {
            let res = urlFilterListToRegex(settings.whitelist);
            res.test("test");
            return res;
        } catch (e) {
            return RegExp("");
        }
    }

    public static blacklistRegexp(settings: BeGoneSettings): RegExp {
        try {
            let res = urlFilterListToRegex(settings.blacklist);
            res.test("test");
            return res;
        } catch (e) {
            return RegExp("^_matches_nothing_$");
        }
    }
}

export class BeGone {
    public version = 2.7; // TODO: warum ist hier ein version?
    private settings: BeGoneSettings = {aktiv: true, partizip: true, doppelformen: true, skip_topic: false};

    private mtype: ResponseType | undefined = undefined;

    private replacer: SchreibAlternative;
    private readonly changeHighlighter = new ChangeHighlighter();
    private readonly changeAllowedChecker = new ChangeAllowedChecker();
    private observerInstalled = false;
    private languageWatcher: MutationObserver | undefined = undefined;

    constructor(replacer: SchreibAlternative = new Phettberg(), settings?: BeGoneSettings) {
        this.replacer = replacer;
        if (settings) {
            this.settings = settings;
        }
    }

    private log(...s: any[]) {
        ifDebugging && console.log("BG", ...s, "\n" + stackToBeGone(1).join("\n"));
    }

    /**
     * Supports iframes and shadowRoots (using SuperPowerfulTreeWalker)
     */
    private textNodesUnder(el: Node): Array<CharacterData> {
        this.log("textNodesUnder", el);
        let resultArray = new Array<CharacterData>();
        let shouldNotBeChanged = this.changeAllowedChecker.shouldNotBeChanged;
        let acceptNode = (node: Node) => {
            //Nodes mit weniger als 5 Zeichen nicht filtern
            if (!node.textContent || node.textContent.length < 5) {
                // this.log("Rejected a", node);
                return NodeFilter.FILTER_REJECT;
            } else {
                //Eingabeelemente, <script>, <style>, <code>-Tags nicht filtern
                if (shouldNotBeChanged(node)) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Nur Nodes erfassen, deren Inhalt ungefähr zur späteren Verarbeitung passt
                // fahrende|ierende|Mitarbeitende|Forschende
                else if (/\b(und|oder|bzw)|[a-zA-ZäöüßÄÖÜ][\/*.&_·:(]-?[a-zA-ZäöüßÄÖÜ]|[a-zäöüß(_*:.][iI][nN]|nE\b|r[MS]\b|e[NR]\b|ierten?\b|enden?\b|flüch/.test(node.textContent)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
            //this.log("Rejected b", node, node.textContent);
            return NodeFilter.FILTER_REJECT;
        };

        const walker = new SuperPowerfulTreeWalker<CharacterData>(el, NodeFilter.SHOW_TEXT, acceptNode,
            (node) => {
                // We use a different filter to find iframes, and other inner documents, because the other filter only returns ACCEPT if 'node.textContent' matches something,
                // and 'node.textContent' doesn't contain iframes.
                if (shouldNotBeChanged(node)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            });
        for (let charData of walker) {
            let nodeParent = charData.parentNode;
            if (!nodeParent) {
                resultArray.push(charData);
            } else if (!this.isHTMLFormattingNodeName(nodeParent.nodeName)) {
                resultArray.push(charData);
            } else {
                // we've got a text node that will probably need context to be analyzed (like a word highlighted with a <mark> tag) - save the context nodes as well
                if (nodeParent.previousSibling && nodeParent.previousSibling.nodeType === 3) {
                    resultArray.push(nodeParent.previousSibling as CharacterData);
                }
                resultArray.push(charData);
                if (nodeParent.nextSibling && nodeParent.nextSibling.nodeType === 3) {
                    resultArray.push(nodeParent.nextSibling as CharacterData);
                }
            }
        }

        return resultArray;
    }

    public handleResponse(message: Response) {
        this.settings = JSON.parse(message.response);

        if (!this.settings.aktiv && this.settings.filterliste !== "Bei Bedarf" || this.settings.filterliste == "Bei Bedarf" && message.type !== "ondemand") return;

        this.mtype = message.type;
        if (this.currentPageNotExcludedByWhitelistOrBlackList()) {
            // "Bei Bedarf" heisst: der Nutzer hat aufs Icon geklickt und will es explizit,
            // dann wird die Spracherkennung übersprungen.
            this.startWennDeutsch(document, message.type === "ondemand");
        }
    }

    /**
     * Startet nur, wenn die Seite überhaupt deutschen Text enthält - sonst bleibt lediglich
     * ein billiger Beobachter liegen, der es später nochmal versucht.
     */
    private startWennDeutsch(doc: Document, ohnePruefung: boolean) {
        if (ohnePruefung || looksGerman(this.textFuerSpracherkennung(doc))) {
            this.start(doc);
        } else {
            this.watchForGerman(doc);
        }
    }

    private start(doc: Document) {
        this.stopLanguageWatcher();

        //Entfernen bei erstem Laden der Seite
        this.entferneInitial(doc);

        //Entfernen bei Seitenänderungen
        if (!this.observerInstalled) {
            this.observerInstalled = true;
            this.installMutationObserver(doc);
        }
    }

    /**
     * Bewusst nur body.textContent statt superPowerfulTextContentOf(): letzteres krault alle
     * iframes und shadow roots durch und installiert dabei Observer - also genau die Arbeit,
     * die auf einer nicht-deutschen Seite gespart werden soll. Deutscher Text, der
     * ausschliesslich in einem iframe oder shadow root steht, wird dadurch nicht erkannt.
     */
    private textFuerSpracherkennung(doc: Document): string {
        return doc.body ? (doc.body.textContent || "") : "";
    }

    /**
     * Auf SPAs (reddit, X, ...) entsteht der deutsche Inhalt erst nach dem Laden oder nach einer
     * client-seitigen Navigation. Deshalb bleibt ein entprellter MutationObserver liegen, der die
     * Spracherkennung wiederholt. Bewusst ein normaler MutationObserver und nicht der
     * SuperPowerfulMutationObserver, damit hier keine Krabbelarbeit über iframes und shadow roots anfällt.
     */
    private watchForGerman(doc: Document) {
        if (this.languageWatcher || typeof MutationObserver === "undefined") {
            return;
        }
        let pruefungLaeuft = false;
        this.languageWatcher = new MutationObserver(() => {
            if (pruefungLaeuft) {
                return;
            }
            pruefungLaeuft = true;
            setTimeout(() => {
                pruefungLaeuft = false;
                if (this.languageWatcher && looksGerman(this.textFuerSpracherkennung(doc))) {
                    this.log("Spracherkennung: jetzt deutsch");
                    this.start(doc);
                }
            }, LANGUAGE_RECHECK_DELAY_MS);
        });
        this.languageWatcher.observe(doc.body || doc.documentElement, {childList: true, subtree: true});
    }

    private stopLanguageWatcher() {
        if (this.languageWatcher) {
            this.languageWatcher.disconnect();
            this.languageWatcher = undefined;
        }
    }


    private installMutationObserver(doc: Document) {
        try {
            let callback = (mutations: MutationRecord[]) => {
                // Der changeAllowedChecker muss geupdated werden bevor entferneInserted(.) aufgerufen wird
                this.changeAllowedChecker.handleMutations(mutations);

                let insertedNodes = new Array<CharacterData>();
                mutations.forEach((mutation: MutationRecord) => {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        let node = mutation.addedNodes[i];
                        insertedNodes = insertedNodes.concat(this.textNodesUnder(node));
                    }
                });
                this.entferneInserted(insertedNodes);
            };
            const superObserver = new SuperPowerfulMutationObserver(callback, {
                childList: true,
                subtree: true,
                // attributes needed for changeAllowedChecker
                attributes: true,
                characterData: false,
            });
            superObserver.observe(doc);
        } catch (e) {
            console.error(e);
            chrome.runtime.sendMessage({
                action: 'error',
                page: doc.location.hostname,
                source: 'gendersprachekorrigieren.js',
                error: e
            } as ErrorRequest);
        }
    }

    private currentPageNotExcludedByWhitelistOrBlackList() {
        if (!BeGoneSettingsHelper.isWhitelist(this.settings) && !BeGoneSettingsHelper.isBlacklist(this.settings)) {
            // no filtering
            return true;
        }
        if (BeGoneSettingsHelper.isWhitelist(this.settings) && BeGoneSettingsHelper.whitelistRegexp(this.settings).test(document.URL)) {
            // White listed
            return true;
        }
        return BeGoneSettingsHelper.isBlacklist(this.settings) && !BeGoneSettingsHelper.blacklistRegexp(this.settings).test(document.URL);
    }

    private probeDocument(doc: Document | Element) {
        return this.probeDocumentContent(superPowerfulTextContentOf(doc))
    }

    /**
     * Prüft, ob der Text, generell infrage kommt für Veränderungen.
     */
    private probeDocumentContent(bodyTextContent: string):
        {
            probeBinnenI: boolean,
            probeRedundancy: boolean,
            probePartizip: boolean,
            probeGefluechtete: boolean,
            probeArtikelUndKontraktionen: boolean;
        } {
        const result = {
            probeBinnenI: false,
            probeRedundancy: false,
            probePartizip: false,
            probeGefluechtete: false,
            probeArtikelUndKontraktionen: false
        };

        if (!this.settings.skip_topic || (this.settings.skip_topic && (this.mtype == "ondemand" || !/Binnen-I|Geflüchtete/.test(bodyTextContent)))) {
            result.probeBinnenI = /[a-zäöüß]{2}((\/-?|_|\*|:|\.|\u00b7| und -)?In|(\/-?|_|\*|:|\.|\u00b7| und -)in(n[*|.:]en)?|(\/-?|_|\*|:|\.|\u00b7)ze|(\/-?|_|\*|:|\.|\u00b7)[ar]|(\/-?|_|\*|:|\.|\u00b7)nja|INNen|\([Ii]n+(en\)|\)en)?|\/inne?)/.test(bodyTextContent)
                || /[A-ZÄÖÜß]{3}(\/-?|_|\*|:|\.)IN\b|(der|die|dessen|ein|sie|ihr|sein|zu[rm]|jede|frau|man|eR\b|em?[\/*.&_(])/.test(bodyTextContent);
            result.probeArtikelUndKontraktionen = /[a-zA-ZäöüßÄÖÜ][\/*.&_(]-?[a-zA-ZäöüßÄÖÜ]/.test(bodyTextContent) || /der|die|dessen|ein|sie|ihr|sein|zu[rm]|jede|frau|man|eR\b|em?[\/*.&_(]-?e?r\b|em?\(e?r\)\b/.test(bodyTextContent);

            if (this.settings.doppelformen) {
                result.probeRedundancy = /\b(und|oder|bzw)\b/.test(bodyTextContent);
            }
            if (this.settings.partizip) {
                result.probePartizip = /ierende|Mitarbeitende|Forschende|fahrende|verdienende|Interessierte|Teilnehmende|esende/.test(bodyTextContent);
            }
            if (this.settings.partizip) {
                // immer "flüch" testen, "flücht" schlug wegen soft hyphens schon fehl
                result.probeGefluechtete = /flüch/.test(bodyTextContent);
                // TODO: bug, for some reason I need to set probeBinnenI to true to make the test pass.
                result.probeBinnenI ||= result.probeGefluechtete;
            }
        }

        return result
    }

    private isHTMLFormattingNodeName(nodeName?: string): boolean {
        if (!nodeName) {
            return false;
        }

        nodeName = nodeName.toLowerCase();

        return nodeName === "mark"
            || nodeName === "b"
            || nodeName === "strong"
            || nodeName === "i"
            || nodeName === "em"
            || nodeName === "small"
            || nodeName === "del"
            || nodeName === "ins"
            || nodeName === "sub"
            || nodeName === "sup"
            || nodeName === "a";
    }

    // unfortunately this lead to newlines being removed in tweets on Twitter etc.; TODO: once FireFox supports the dotAll operator we should use this in the regexes instead, or modify the regexes to handle newlines as whitespace
    private replaceLineBreak(s: string) {
        let counter = function () {
        };
        return new Replacement(String.raw`(\n|\r|\r\n)`, "ig", " ", "").replace(s, counter);
    }

    /**
     * Combines several replacement steps into a single text transformation.
     *
     * This has to be a single transformation, because applyToNodes() may replace a text node by
     * several new nodes (see ChangeHighlighter). Running the steps one after the other over the same
     * node list would apply all but the first step to nodes that are no longer part of the document.
     */
    private static combine(modifiers: Array<(this: void, s: string) => string>): (this: void, s: string) => string {
        return (s: string) => modifiers.reduce((text, modify) => modify(text), s);
    }

    private applyToNodes(nodes: Array<CharacterData>, modifyData: (this: void, s: string) => string) {
        const textnodes = nodes;
        for (let i = 0; i < textnodes.length; i++) {
            const node = textnodes[i];
            const oldText = node.data;
            let newText = oldText;

            const parentNodeName = node.parentNode ? node.parentNode.nodeName.toLowerCase() : "";
            // special treatment of HTML nodes that are only there for formatting; those might tear a word out of its context which is important for correcting
            if (this.isHTMLFormattingNodeName(parentNodeName)) {
                // this word needs to be replaced in context
                let oldTextInContext = (i > 0 ? textnodes[i - 1].data : "") + "\f" + oldText + "\f" + (i < textnodes.length - 1 ? textnodes[i + 1].data : "");
                //oldTextInContext = this.replaceLineBreak(oldTextInContext);
                oldTextInContext = modifyData(oldTextInContext);
                const index1 = oldTextInContext.indexOf("\f");
                const index2 = oldTextInContext.indexOf("\f", index1 + 1);
                const index3 = oldTextInContext.indexOf("\f", index2 + 1);
                if (index1 > -1 && index2 > -2 && index3 === -1) // sanity check - RegEx magic might remove our marker; fall back to old behavior in this case
                {
                    newText = oldTextInContext.substring(index1 + 1, index2);
                } else {
                    //oldText = this.replaceLineBreak(oldText);
                    newText = modifyData(oldText);
                }
            } else {
                //oldText = this.replaceLineBreak(oldText);
                newText = modifyData(oldText);
            }

            // this.log(node.data ,"!== ??", newText);
            if (node.data !== newText) {
                const hervorheben = !!this.settings.hervorheben;
                const tooltip = !!this.settings.tooltip;
                if (hervorheben || tooltip) {
                    // wrap the changed words in some <span>, to highlight them and/or to show the original text on hover
                    this.changeHighlighter.apply(node, newText, hervorheben ? (this.settings.hervorheben_style || "") : "", tooltip);
                } else {
                    node.data = newText;
                }
            }
        }
    }

    public entferneInitial(doc: Document | Element = document): void {
        this.log("entferneInitial")
        const probeResult = this.probeDocument(doc)

        if (probeResult.probeBinnenI || this.settings.doppelformen && probeResult.probeRedundancy || this.settings.partizip && probeResult.probePartizip || probeResult.probeArtikelUndKontraktionen) {
            let nodes = this.textNodesUnder(doc);

            let modifiers = new Array<(this: void, s: string) => string>();
            if (this.settings.doppelformen && probeResult.probeRedundancy) {
                modifiers.push(this.replacer.entferneDoppelformen);
            }
            if (this.settings.partizip && probeResult.probePartizip) {
                modifiers.push(this.replacer.entfernePartizip);
            }
            if (probeResult.probeBinnenI) {
                modifiers.push(this.replacer.entferneBinnenIs);
            }
            if (this.settings.partizip && probeResult.probeGefluechtete) {
                modifiers.push(this.replacer.ersetzeGefluechteteDurchFluechtlinge);
            }

            if (probeResult.probeArtikelUndKontraktionen) {
                modifiers.push(this.replacer.artikelUndKontraktionen);
            }

            this.applyToNodes(nodes, BeGone.combine(modifiers));

            if (this.settings.counter) {
                this.sendCounttoBackgroundScript();
            }
        }
    }

    public entferneInitialForTesting(s: string): string {
        const probeResult = this.probeDocumentContent(s)

        if (probeResult.probeBinnenI || probeResult.probeArtikelUndKontraktionen ||
            this.settings.doppelformen && probeResult.probeRedundancy ||
            this.settings.partizip && probeResult.probePartizip ||
            this.settings.partizip && probeResult.probeGefluechtete) {
            if (this.settings.doppelformen && probeResult.probeRedundancy) {
                s = this.replacer.entferneDoppelformen(s);
            }
            if (this.settings.partizip && probeResult.probePartizip) {
                s = this.replacer.entfernePartizip(s);
            }
            if (probeResult.probeBinnenI) {
                s = this.replacer.entferneBinnenIs(s);
            }
            if (this.settings.partizip && probeResult.probeGefluechtete) {
                s = this.replacer.ersetzeGefluechteteDurchFluechtlinge(s);
            }

            if (probeResult.probeArtikelUndKontraktionen) {
                s = this.replacer.artikelUndKontraktionen(s);
            }

            if (this.settings.counter) {
                this.sendCounttoBackgroundScript();
            }
        }
        return s;
    }

    private entferneInserted(nodes: Array<CharacterData>) {
        this.log("entferneInserted");
        if (!this.settings.skip_topic || this.settings.skip_topic && (this.mtype == "ondemand" || !/Binnen-I/.test(document.body.textContent ? document.body.textContent : ""))) {
            let modifiers = new Array<(this: void, s: string) => string>();
            if (this.settings.doppelformen) {
                modifiers.push(this.replacer.entferneDoppelformen);
            }
            if (this.settings.partizip) {
                modifiers.push(this.replacer.entfernePartizip);
            }
            modifiers.push(this.replacer.entferneBinnenIs);

            if (this.settings.partizip) {
                modifiers.push(this.replacer.ersetzeGefluechteteDurchFluechtlinge);
            }

            modifiers.push(this.replacer.artikelUndKontraktionen);

            this.applyToNodes(nodes, BeGone.combine(modifiers));

            if (this.settings.counter) {
                this.sendCounttoBackgroundScript();
            }
        }
    }

    public notifyBackgroundScript() {
        chrome.runtime.sendMessage({
            action: 'needOptions'
        } as NeedOptionsRequest, (res: Response) => {
            this.handleResponse(res);
        });
    }

    private sendCounttoBackgroundScript() {
        chrome.runtime.sendMessage({
            countBinnenIreplacements: this.replacer.replacementsBinnen,
            countDoppelformreplacements: this.replacer.replacementsDoppel,
            countPartizipreplacements: this.replacer.replacementsPartizip,
            type: "count"
        } as CountRequest);
    }
}

if (typeof document != "undefined" && document.body.textContent) {
    const beGone = new BeGone();
    //Einstellungen laden
    beGone.notifyBackgroundScript();
    chrome.runtime.onMessage.addListener((message: Response) => {
        beGone.handleResponse(message);
    });
}