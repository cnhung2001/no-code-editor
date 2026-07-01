import './main.css';
import { DivProEditor, type DivProEditorInstance, type Locale } from './lib';
import { convertDictToPalette, convertPaletteToDict } from './lib/utils/convertPalette';
import langAuto from './auto/lang.json';
import { addTemplatesSuffix, removeTemplatesSuffix } from './lib/utils/renameTemplates';

const themeQuery = matchMedia('(prefers-color-scheme: dark)');

themeQuery.addListener(() => {
    editor.setTheme(themeQuery.matches ? 'dark' : 'light');
});

const AVAIL_LOCALES: Locale[] = ['ru', 'en'];
const detectLocale = (): Locale => {
    for (const item of navigator.languages) {
        const parts = item.split('-');
        const part = parts[0] as Locale;
        if (AVAIL_LOCALES.includes(part)) {
            return part;
        }
    }
    return 'en';
};

window.addEventListener('languagechange', () => {
    if (editor) {
        editor.setLocale(detectLocale());
    }
});

declare global {
    interface Window {
        editor: DivProEditorInstance;
        convertDictToPalette: typeof convertDictToPalette;
        convertPaletteToDict: typeof convertPaletteToDict;
        addTemplatesSuffix: typeof addTemplatesSuffix;
        removeTemplatesSuffix: typeof removeTemplatesSuffix;
    }
}

const editor = window.editor = DivProEditor.init({
    renderTo: document.getElementById('app') as HTMLElement,
    locale: detectLocale(),
    rootConfigurable: true,
    fileLimits: {
        image: {
            warn: 1000,
            error: 1000000
        },
        lottie: {
            warn: 1000,
            error: 1000000
        },
        video: {
            warn: 1000,
            error: 1000000
        },
        preview: {
            warn: 1000,
            error: 1000000
        },
        upload: {
            error: 1000000
        }
    },
    imageConversion: {
        quality: .75,
        formats: {
            png: true,
            jpg: true,
            webp: true,
            // avif: true
        }
    },
    customFontFaces: [{
        value: 'monospace',
        text: {
            ru: 'Моноширинный',
            en: 'Monospace'
        },
        cssValue: 'monospace'
    }],
    directionSelector: true,
    safeAreaEmulation: {
        top: {
            name: 'safe_area_top',
            value: 40
        },
        right: {
            name: 'safe_area_right',
            value: 0
        },
        bottom: {
            name: 'safe_area_bottom',
            value: 20
        },
        left: {
            name: 'safe_area_left',
            value: 0
        }
    },
    fitViewportOnCreate: true,
    card: {
        json: JSON.stringify({
            templates: {
                tutorialCard: {
                    type: 'container',
                    items: [
                        {
                            type: 'text',
                            font_size: 21,
                            font_weight: 'bold',
                            margins: {
                                bottom: 16
                            },
                            $text: 'title'
                        },
                        {
                            type: 'text',
                            font_size: 16,
                            margins: {
                                bottom: 16
                            },
                            $text: 'body'
                        },
                        {
                            type: 'container',
                            $items: 'links'
                        }
                    ],
                    margins: {
                        bottom: 6
                    },
                    orientation: 'vertical',
                    paddings: {
                        top: 10,
                        bottom: 0,
                        left: 30,
                        right: 30
                    }
                },
                link: {
                    type: 'text',
                    action: {
                        $url: 'link',
                        $log_id: 'log'
                    },
                    font_size: 14,
                    margins: {
                        bottom: 2
                    },
                    text_color: '#0000ff',
                    underline: 'single',
                    $text: 'link_text'
                }
            },
            card: {
                log_id: 'div2_sample_card',
                states: [
                    {
                        state_id: 0,
                        div: {
                            type: 'container',
                            width: { type: 'match_parent' },
                            height: { type: 'match_parent' },
                            background: [
                                {
                                    type: 'solid',
                                    color: '#ffffff'
                                }
                            ],
                            items: [
                                {
                                    type: 'tutorialCard',
                                    title: 'DivKit',
                                    body: 'What is DivKit and why did I get here?\n\nDivKit is a new Yandex open source framework that helps speed up mobile development.\n\niOS, Android, Web — update the interface of any applications directly from the server, without publishing updates.\n\nFor 5 years we have been using DivKit in the Yandex search app, Alice, Edadeal, Market, and now we are sharing it with you.\n\nThe source code is published on GitHub under the Apache 2.0 license.',
                                    links: [
                                        {
                                            type: 'link',
                                            link_text: 'More about DivKit',
                                            link: 'https://divkit.tech/',
                                            log: 'landing'
                                        },
                                        {
                                            type: 'link',
                                            link_text: 'Documentation',
                                            link: 'https://divkit.tech/doc/',
                                            log: 'docs'
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                ]
            }
        }),
    },
    theme: themeQuery.matches ? 'dark' : 'light',
    layout: [
        {
            items: ['preview'],
            weight: 3
        },
        {
            items: ['component-props:code'],
            minWidth: 360
        }
    ],
    actionLogUrlVariable: 'on_click_log_url',
    paletteEnabled: true,
    cardLocales: [{
        id: 'ru',
        text: {
            ru: 'RU',
            en: 'RU'
        }
    }, {
        id: 'en',
        text: {
            ru: 'EN',
            en: 'EN'
        }
    }],
    sources: [{
        key: 'test',
        url: 'https://ya.ru/api',
        example: {
            logged: 1,
            login: 'Vasya',
            mailCount: 123
        }
    }],
    customActions: [{
        baseUrl: 'div-screen://close',
        text: {
            ru: 'Закрыть',
            en: 'Close'
        }
    }, {
        baseUrl: 'div-screen://open',
        text: {
            ru: 'Открыть',
            en: 'Open'
        },
        args: [{
            type: 'string',
            name: 'id',
            text: {
                ru: 'ID',
                en: 'ID'
            }
        }]
    }, {
        baseUrl: 'div-screen://next_slide',
        text: {
            ru: 'Следующий',
            en: 'Next'
        }
    }],
    // readOnly: true,
    api: {
        getTranslationKey(key) {
            return new Promise(resolve => {
                setTimeout(() => {
                    if (key in langAuto.ru) {
                        const res: Record<string, string> = {};

                        res.ru = String(langAuto.ru[key as keyof typeof langAuto.ru]);
                        res.en = String(langAuto.en[key as keyof typeof langAuto.en]);

                        resolve(res);
                    } else {
                        resolve(undefined);
                    }
                }, Math.random() * 500);
            });
        },
        getTranslationSuggest(query, locale) {
            return new Promise(resolve => {
                setTimeout(() => {
                    const obj = langAuto[locale as keyof typeof langAuto];
                    const folders = [...new Set(
                        Object.keys(obj)
                            .filter(key => key.includes('.'))
                            .map(key => key.split('.')[0] + '.')
                    )];

                    resolve(folders.concat(Object.keys(obj)).filter(key => key.startsWith(query) && !(query.endsWith('.') && key === query)).map(key => {
                        return {
                            key,
                            text: String(obj[key as keyof typeof obj])
                        };
                    }));
                }, Math.random() * 500);
            });
        }
    }
});

window.convertDictToPalette = convertDictToPalette;
window.convertPaletteToDict = convertPaletteToDict;

window.addTemplatesSuffix = addTemplatesSuffix;
window.removeTemplatesSuffix = removeTemplatesSuffix;
