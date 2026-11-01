import type { TemplateComponent, TemplateFailure } from '@reaplift/shared';

/**
 * Local checks run before a template goes to Meta. Limits and language codes checked against Meta's template pages
 * on 31 October 2026. Meta's pages do not state the rules on where a variable may sit (`variablePlacement`); those
 * come from this project's spec, as templates breaking them are commonly rejected.
 */
const NAME_MAX = 512;
const HEADER_TEXT_MAX = 60;
const BODY_MAX = 1024;
const FOOTER_MAX = 60;
const BUTTON_TEXT_MAX = 25;
const BUTTONS_MAX = 10;
const URL_BUTTONS_MAX = 2;
const PHONE_BUTTONS_MAX = 1;
const URL_MAX = 2000;
const PHONE_MAX = 20;

export const META_LANGUAGES = new Set(
  'af sq ar ar_EG ar_AE ar_LB ar_MA ar_QA az be_BY bn bn_IN bg ca zh_CN zh_HK zh_TW hr cs da prs_AF nl nl_BE en en_GB en_US en_AE en_AU en_CA en_GH en_IE en_IN en_JM en_MY en_NZ en_QA en_SG en_UG en_ZA et fil fi fr fr_BE fr_CA fr_CH fr_CI fr_MA ka de de_AT de_CH el gu ha he hi hu id ga it ja kn kk rw_RW ko ky_KG lo lv lt mk ms ml mr nb ps_AF fa pl pt_BR pt_PT pa ro ru sr si_LK sk sl es es_AR es_CL es_CO es_CR es_DO es_EC es_HN es_MX es_PA es_PE es_ES es_UY sw sv ta te th tr uk ur uz vi zu'.split(
    ' ',
  ),
);

export interface TemplateDraft {
  name: string;
  language: string;
  category: string;
  components: TemplateComponent[];
}

export interface RuleContext {
  promoWords: string[];
}

type Rule = (template: TemplateDraft, context: RuleContext) => TemplateFailure[];

const part = (t: TemplateDraft, type: TemplateComponent['type']) => t.components.find((c) => c.type === type);
const buttonsOf = (t: TemplateDraft) => part(t, 'BUTTONS')?.buttons ?? [];
const VARIABLE = /\{\{\s*([^}]*?)\s*\}\}/g;
const variablesIn = (text: string) => [...text.matchAll(VARIABLE)].map((m) => m[1]!);
const fail = (rule: string, field: string, message: string, fix: string): TemplateFailure => ({
  rule,
  field,
  message,
  fix,
});

function findsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A word boundary only makes sense beside a letter or digit: "% off" starts with a symbol.
  const start = /^\w/.test(word) ? '\\b' : '';
  const end = /\w$/.test(word) ? '\\b' : '';
  return new RegExp(`${start}${escaped}${end}`, 'i').test(text);
}

const categoryFit: Rule = (t, { promoWords }) => {
  if (t.category === 'MARKETING') return [];
  const body = part(t, 'BODY')?.text ?? '';
  const found = promoWords.filter((word) => findsWord(body, word));
  if (found.length === 0) return [];
  return [
    fail(
      'category_fit',
      'category',
      `The body contains promotional words (${found.map((w) => `'${w}'`).join(', ')}). ${t.category} templates cannot advertise.`,
      'Change the category to MARKETING, or remove these words.',
    ),
  ];
};

const bodyPresent: Rule = (t) =>
  t.components.filter((c) => c.type === 'BODY').length === 1 && part(t, 'BODY')?.text?.trim()
    ? []
    : [fail('body_required', 'body', 'A template needs exactly one body with text.', 'Add the body text.')];

const variableOrder: Rule = (t) => {
  const failures: TemplateFailure[] = [];
  for (const type of ['HEADER', 'BODY'] as const) {
    const component = part(t, type);
    const field = type.toLowerCase();
    const found = variablesIn(component?.text ?? '');
    const samples =
      type === 'BODY' ? (component?.example?.body_text?.[0] ?? []) : (component?.example?.header_text ?? []);
    const distinct = [...new Set(found)];
    if (distinct.some((name) => !/^[1-9]\d*$/.test(name)) || distinct.some((name, i) => Number(name) !== i + 1)) {
      failures.push(
        fail('variable_order', field, `Variables must be {{1}}, {{2}}, ... in order with no gaps; found ${found.map((n) => `{{${n}}}`).join(', ')}.`, 'Renumber the variables.'),
      );
    }
    if (samples.length !== distinct.length || samples.some((sample) => !sample.trim())) {
      failures.push(
        fail('variable_samples', field, `Each variable needs one sample value: ${distinct.length} variables, ${samples.length} samples.`, 'Give one sample per variable.'),
      );
    }
    if (type === 'HEADER' && distinct.length > 1) {
      failures.push(fail('header_variables', field, 'A header can have only one variable.', 'Keep one variable in the header.'));
    }
  }
  return failures;
};

const variablePlacement: Rule = (t) => {
  const text = (part(t, 'BODY')?.text ?? '').trim();
  const failures: TemplateFailure[] = [];
  if (/^\{\{[^}]*\}\}/.test(text) || /\{\{[^}]*\}\}[\s.!?]*$/.test(text)) {
    failures.push(fail('variable_edges', 'body', 'The body cannot start or end with a variable.', 'Add words before and after it.'));
  }
  if (/\}\}\s*\{\{/.test(text)) {
    failures.push(fail('variables_adjacent', 'body', 'Two variables cannot be next to each other.', 'Put words between them.'));
  }
  return failures;
};

const tooLong = (rule: string, field: string, value: string | undefined, max: number) =>
  (value?.length ?? 0) > max
    ? [fail(rule, field, `${field} is ${value!.length} characters; the most Meta allows is ${max}.`, `Shorten it to ${max}.`)]
    : [];

const lengths: Rule = (t) => [
  ...tooLong('name_length', 'name', t.name, NAME_MAX),
  ...tooLong('header_length', 'header', part(t, 'HEADER')?.format === 'TEXT' ? part(t, 'HEADER')?.text : undefined, HEADER_TEXT_MAX),
  ...tooLong('body_length', 'body', part(t, 'BODY')?.text, BODY_MAX),
  ...tooLong('footer_length', 'footer', part(t, 'FOOTER')?.text, FOOTER_MAX),
  ...buttonsOf(t).flatMap((b) => tooLong('button_length', 'buttons', b.text, BUTTON_TEXT_MAX)),
];

const nameFormat: Rule = (t) =>
  /^[a-z0-9_]+$/.test(t.name)
    ? []
    : [fail('name_format', 'name', 'The name can use only lowercase letters, digits and underscores.', 'For example: diwali_offer_2026.')];

const languageSupported: Rule = (t) =>
  META_LANGUAGES.has(t.language)
    ? []
    : [fail('language', 'language', `Meta does not support the language code "${t.language}".`, 'Pick one from the list, such as en_US.')];

const mediaHeader: Rule = (t) => {
  const header = part(t, 'HEADER');
  if (!header?.format || header.format === 'TEXT' || header.example?.header_handle?.length === 1) return [];
  return [fail('media_file', 'header', `A ${header.format.toLowerCase()} header needs a sample file.`, 'Upload one.')];
};

const buttons: Rule = (t) => {
  const all = buttonsOf(t);
  const failures: TemplateFailure[] = [];
  if (all.length > BUTTONS_MAX) failures.push(fail('button_count', 'buttons', `At most ${BUTTONS_MAX} buttons are allowed.`, 'Remove some.'));
  if (all.filter((b) => b.type === 'URL').length > URL_BUTTONS_MAX) {
    failures.push(fail('button_count', 'buttons', `At most ${URL_BUTTONS_MAX} URL buttons are allowed.`, 'Remove some.'));
  }
  if (all.filter((b) => b.type === 'PHONE_NUMBER').length > PHONE_BUTTONS_MAX) {
    failures.push(fail('button_count', 'buttons', `At most ${PHONE_BUTTONS_MAX} phone button is allowed.`, 'Remove the others.'));
  }
  for (const button of all) {
    if (button.type === 'URL') {
      const url = button.url ?? '';
      const variables = variablesIn(url);
      const fixed = url.replace(VARIABLE, 'x');
      let https = false;
      try {
        https = new URL(fixed).protocol === 'https:';
      } catch {
        https = false;
      }
      const atEnd = variables.length === 0 || (variables.length === 1 && /\{\{\s*1\s*\}\}$/.test(url));
      if (!https || !atEnd || url.length > URL_MAX) {
        failures.push(fail('button_url', 'buttons', `"${button.text}" needs a valid https address, up to ${URL_MAX} characters, with at most one variable at the end.`, 'Use an address like https://example.com/{{1}}.'));
      } else if (variables.length === 1 && button.example?.length !== 1) {
        failures.push(fail('button_url', 'buttons', `"${button.text}" has a variable and needs one sample value.`, 'Add a sample.'));
      }
    }
    if (button.type === 'PHONE_NUMBER' && !/^\+?[0-9]{5,20}$/.test(button.phone_number ?? '') ) {
      failures.push(fail('button_phone', 'buttons', `"${button.text}" needs a valid phone number, up to ${PHONE_MAX} digits.`, 'Use digits with the country code.'));
    }
  }
  return failures;
};

/** New rules are added here; nothing else changes. */
const RULES: Rule[] = [
  bodyPresent,
  nameFormat,
  languageSupported,
  categoryFit,
  variableOrder,
  variablePlacement,
  lengths,
  mediaHeader,
  buttons,
];

export function checkTemplate(template: TemplateDraft, context: RuleContext): TemplateFailure[] {
  return RULES.flatMap((rule) => rule(template, context));
}
