/**
 * Copyright 2015 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {variableServiceFor} from '../variables';
import {adopt} from '../../../../src/runtime';
import {cryptoFor} from '../../../../src/crypto';

adopt(window);

describe('amp-analytics.VariableService', function() {
  let variables;
  beforeEach(() => {
    return cryptoFor(window).then(() => {
      variables = variableServiceFor(window);
    });
  });

  it('correctly encodes scalars and arrays', () => {
    expect(variables.encodeVars('abc %&')).to.equal('abc%20%25%26');
    const array = ['abc %&', 'a b'];
    expect(variables.encodeVars(array)).to.equal('abc%20%25%26,a%20b');
    // Test non-inplace semantics by testing again.
    expect(variables.encodeVars(array)).to.equal('abc%20%25%26,a%20b');
  });

  describe('expandTemplate', () => {
    const vars = {
      'vars': {'1': '1${2}', '2': '2${3}', '3': '3${4}', '4': '4${1}'}};

    it('expands nested vars', () => {
      return variables.expandTemplate('${1}', vars).then(actual =>
        expect(actual).to.equal('123%252524%25257B4%25257D')
      );
    });

    it('limits the recursion to n', () => {
      return variables.expandTemplate('${1}', vars, {}, {}, 3).then(actual =>
        expect(actual).to.equal('1234%25252524%2525257B1%2525257D')
      ).then(() =>
        variables.expandTemplate('${1}', vars, {}, {}, 5).then(actual =>
          expect(actual).to
              .equal('123412%252525252524%25252525257B3%25252525257D')
      ));
    });

    it('works with complex params (1)', () => {
      const vars = {'vars': {'fooParam': 'QUERY_PARAM(foo,bar)'}};
      return variables.expandTemplate('${fooParam}', vars).then(actual =>
        expect(actual).to.equal('QUERY_PARAM(foo,bar)')
      );
    });

    it('works with complex params (2)', () => {
      const vars = {'vars': {'fooParam': 'QUERY_PARAM'}};
      return variables.expandTemplate('${fooParam(foo,bar)}', vars)
          .then(actual => expect(actual).to.equal('QUERY_PARAM(foo,bar)'));
    });
  });

  describe('filter:', () => {
    const vars = {'vars': {'foo': ' Hello world! '}};

    function check(input, output) {
      return variables.expandTemplate(input, vars, {}).then(actual =>
          expect(actual).to.equal(output));
    }

    it('default works', () => {
      return check('${bar|default:baz}', 'baz');
    });

    it.skip('hash works', () => {
      return check('${foo|hash}', 'baz');
    });
    it('substr works', () => {
      return check('${foo|substr:2:4}', 'ello');
    });
    it('trim works', () => {
      return check('${foo|trim}', 'Hello%20world!');
    });
    it('json works', () => {
      // " Hello world! "
      return check('${foo|json}', '%22%20Hello%20world!%20%22');
    });
    it('toLowerCase works', () => {
      return check('${foo|toLowerCase}', '%20hello%20world!%20');
    });
    it('toUpperCase works', () => {
      return check('${foo|toUpperCase}', '%20HELLO%20WORLD!%20');
    });
    it('not works', () => {
      return check('${foo|not}', 'false');
    });
    it('base64 works', () => {
      return check('${foo|base64}', 'IEhlbGxvIHdvcmxkISA%3D');
    });
    it('if works', () => {
      return check('${foo|if:yey:boo}', 'yey');
    });
  });
});
