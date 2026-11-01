import { describe, expect, it } from 'vitest';
import type { TemplateComponent } from '@reaplift/shared';
import { checkTemplate, type TemplateDraft } from '../src/modules/templates/rules.js';

const body = (text: string, samples: string[] = []): TemplateComponent => ({
  type: 'BODY',
  text,
  ...(samples.length > 0 && { example: { body_text: [samples] } }),
});
const good: TemplateDraft = {
  name: 'order_update',
  language: 'en_US',
  category: 'UTILITY',
  components: [body('Hi {{1}}, your order {{2}} has shipped today.', ['Rahul', 'A12'])],
};
const rulesFor = (changes: Partial<TemplateDraft>) =>
  checkTemplate({ ...good, ...changes }, { promoWords: ['flat', '% off', 'sale'] }).map((f) => f.rule);
const withButton = (button: NonNullable<TemplateComponent['buttons']>[number]): Partial<TemplateDraft> => ({
  components: [...good.components, { type: 'BUTTONS', buttons: [button] }],
});

describe('5.3 template rules', () => {
  it('passes a good template', () => {
    expect(rulesFor({})).toEqual([]);
  });

  it('category fit: the worked example fails as UTILITY and passes as MARKETING', () => {
    const components = [body('Hi {{1}}, flat 20% off on all orders till Sunday. Use code {{2}} now.', ['Rahul', 'DIWALI20'])];
    const [failure] = checkTemplate({ ...good, components }, { promoWords: ['flat', '% off'] });
    expect(failure).toMatchObject({ rule: 'category_fit', field: 'category' });
    expect(failure?.message).toContain("'flat'");
    expect(failure?.fix).toContain('MARKETING');
    expect(rulesFor({ components, category: 'MARKETING' })).toEqual([]);
  });

  it('category fit matches whole words only', () => {
    expect(rulesFor({ components: [body('Your wholesale order has shipped.')] })).toEqual([]);
  });

  it('needs exactly one body', () => {
    expect(rulesFor({ components: [] })).toContain('body_required');
    expect(rulesFor({ components: [body('One.'), body('Two.')] })).toContain('body_required');
  });

  it('variables run in order with no gaps, each with a sample', () => {
    expect(rulesFor({ components: [body('Hi {{1}}, code {{3}} here.', ['a', 'b'])] })).toContain('variable_order');
    expect(rulesFor({ components: [body('Hi {{name}}, welcome here.', ['a'])] })).toContain('variable_order');
    expect(rulesFor({ components: [body('Hi {{1}}, and {{2}} here.', ['a'])] })).toContain('variable_samples');
    expect(rulesFor({ components: [body('Hi {{1}}, and {{2}} here.', ['a', ' '])] })).toContain('variable_samples');
  });

  it('a variable cannot start or end the body, or touch another', () => {
    expect(rulesFor({ components: [body('{{1}} has shipped today.', ['a'])] })).toContain('variable_edges');
    expect(rulesFor({ components: [body('Your order is {{1}}.', ['a'])] })).toContain('variable_edges');
    expect(rulesFor({ components: [body('Hi {{1}} {{2}} welcome here.', ['a', 'b'])] })).toContain('variables_adjacent');
  });

  it("holds each part to Meta's length", () => {
    const header = (text: string): TemplateComponent => ({ type: 'HEADER', format: 'TEXT', text });
    const footer = (text: string): TemplateComponent => ({ type: 'FOOTER', text });
    expect(rulesFor({ name: 'a'.repeat(513) })).toContain('name_length');
    expect(rulesFor({ components: [...good.components, header('a'.repeat(61))] })).toContain('header_length');
    expect(rulesFor({ components: [...good.components, header('a'.repeat(60))] })).toEqual([]);
    expect(rulesFor({ components: [body('a'.repeat(1025))] })).toContain('body_length');
    expect(rulesFor({ components: [body('a'.repeat(1024))] })).toEqual([]);
    expect(rulesFor({ components: [...good.components, footer('a'.repeat(61))] })).toContain('footer_length');
    expect(rulesFor(withButton({ type: 'QUICK_REPLY', text: 'a'.repeat(26) }))).toContain('button_length');
  });

  it('the name uses lowercase letters, digits and underscores', () => {
    expect(rulesFor({ name: 'Diwali Offer' })).toContain('name_format');
    expect(rulesFor({ name: 'diwali_offer_2026' })).toEqual([]);
  });

  it("the language is one of Meta's codes", () => {
    expect(rulesFor({ language: 'xx_YY' })).toContain('language');
    expect(rulesFor({ language: 'hi' })).toEqual([]);
  });

  it('a media header needs its sample file', () => {
    const image = (handle?: string): TemplateComponent => ({
      type: 'HEADER',
      format: 'IMAGE',
      ...(handle && { example: { header_handle: [handle] } }),
    });
    expect(rulesFor({ components: [...good.components, image()] })).toContain('media_file');
    expect(rulesFor({ components: [...good.components, image('h1')] })).toEqual([]);
  });

  it('URL buttons need https, with one variable at most, at the end, with a sample', () => {
    const url = (address: string, example?: string[]) => withButton({ type: 'URL', text: 'Open', url: address, ...(example && { example }) });
    expect(rulesFor(url('http://example.com'))).toContain('button_url');
    expect(rulesFor(url('not an address'))).toContain('button_url');
    expect(rulesFor(url('https://example.com/{{1}}/x', ['a']))).toContain('button_url');
    expect(rulesFor(url('https://example.com/{{1}}'))).toContain('button_url');
    expect(rulesFor(url('https://example.com/{{1}}', ['a']))).toEqual([]);
    expect(rulesFor(url('https://example.com'))).toEqual([]);
  });

  it('phone buttons need a valid number, and button counts have limits', () => {
    expect(rulesFor(withButton({ type: 'PHONE_NUMBER', text: 'Call', phone_number: 'abc' }))).toContain('button_phone');
    expect(rulesFor(withButton({ type: 'PHONE_NUMBER', text: 'Call', phone_number: '919812345678' }))).toEqual([]);
    const buttons = Array.from({ length: 11 }, () => ({ type: 'QUICK_REPLY' as const, text: 'Yes' }));
    expect(rulesFor({ components: [...good.components, { type: 'BUTTONS', buttons }] })).toContain('button_count');
  });
});
