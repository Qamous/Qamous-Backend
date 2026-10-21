import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedSeoRead} from '../src/seo-trust.ts';

const secret='s'.repeat(64);

test('only the web Worker token exempts SEO service reads from the public API limit',()=>{
  assert.equal(trustedSeoRead('/seo/word/2',secret,secret),true);
  assert.equal(trustedSeoRead('/seo/sitemap/500',secret,secret),true);
  assert.equal(trustedSeoRead('/seo/word/2',undefined,secret),false);
  assert.equal(trustedSeoRead('/seo/word/2','wrong',secret),false);
  assert.equal(trustedSeoRead('/seo/word/2','short','short'),false);
  assert.equal(trustedSeoRead('/seo/word/2',secret,undefined),false);
  assert.equal(trustedSeoRead('/definitions/word/2',secret,secret),false);
});
