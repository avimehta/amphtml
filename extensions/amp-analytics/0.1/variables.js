/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
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

import {dev, user} from '../../../src/log';
import {fromClass} from '../../../src/service';
import {isArray} from '../../../src/types';
import {cryptoFor} from '../../../src/crypto';

const TAG = 'Analytics.Variables';

/** @typedef {function(...?):!Promise<?>} */
let VariableFilterDef;

/** @typedef {function(...?):?} */
let SyncVariableFilterDef;

/**
 * @param  {!string} str
 * @param  {Number} s
 * @param  {Number} l
 * @return {string}
 */
function substrFilter(str, s, l) {
  const start = Number(s);
  const length = Number(l);
  user().assertNumber(start,
    'Start index ' + start + 'in substr filter should be a number');
  user().assertNumber(length,
    'Length ' + length + ' in substr filter should be a number');
  return str.substr(start, length);
}

/**
 * @param  {*} value
 * @param  {*} defaultValue
 * @return {*}
 */
function defaultFilter(value, defaultValue) {
  return value || defaultValue || '';
}


export class VariableService {
  /**
   * @param {!Window} window
   */
  constructor(window) {

    /** @private {!Window} */
    this.win_ = window;

    /** @private {!Object<string, VariableFilterDef>} */
    this.filters_ = Object.create(null);

      /** @private {./crypto-impl.Crypto} */
    this.crypto_ = null;

    this.registerSync_('default', defaultFilter);
    this.registerSync_('substr', substrFilter);
    this.registerSync_('trim', value => user().assertString(value).trim());
    this.registerSync_('json', value => JSON.stringify(value));
    this.registerSync_('toLowerCase', value =>
        user().assertString(value).toLowerCase());
    this.registerSync_('toUpperCase', value =>
        user().assertString(value).toUpperCase());
    this.registerSync_('not', value => String(!value));
    this.registerSync_('base64', value => btoa(String(value)));
    this.register_('hash', this.hashFilter_.bind(this));
    this.register_('if', (value, thenValue, elseValue) =>
        Promise.resolve(Boolean(value)
          ? thenValue
          : elseValue));

    cryptoFor(this.win_).then(crypto => {
      this.crypto_ = crypto;
    });
  }

  /**
   * @param  {string} name
   * @param  {VariableFilterDef} handler
   */
  register_(name, handler) {
    dev().assert(!this.filters_[name], 'Filter "' + name
        + '" already registered.');
    dev().assert(handler, 'Handler for filter ' + name + ' is invalid.');
    this.filters_[name] = handler;
  }

  /**
   * @param  {string} name
   * @param  {SyncVariableFilterDef} handler
   */
  registerSync_(name, handler) {
    this.register_(name, (...args) =>
      Promise.resolve(args[0]).then(value => {
        args.splice(0, 1, value);
        return handler.apply(null, args);
      }));
  }


  /**
   * @param  {string} filterStr
   * @return {!Object<string, *>}
   */
  parseFilter_(filterStr) {
    if (!filterStr) {
      return {};
    }

    // The parsing for filters breaks when `:` is used as something other than
    // the argument separator. A full-fledged parser would be needed to fix
    // this.
    const tokens = filterStr.split(':');
    user().assert(tokens[0], 'Filter ' + name + ' is invalid.');
    const fn = this.filters_[tokens[0]];
    if (!fn) {
      user().error(TAG, 'Invalid filter name: ' + tokens[0]);
      return {};
    }
    return {fn, args: tokens.splice(1)};
  }

  /**
   * @param  {string} value
   * @param  {Array<string>} filters
   * @return {string}
   */
  applyFilters_(value, filters) {
    for (let i = 0; i < filters.length; i++) {
      const parsedFilter = this.parseFilter_(filters[i].trim());
      if (parsedFilter) {
        parsedFilter.args.splice(0, 0, value);
        value = parsedFilter.fn.apply(null, parsedFilter.args);
      }
    }
    return value;
  }

  /**
   * @param {!string} template The template to expand.
   * @param {!JSONType} trigger The object to use for variable value lookups.
   * @param {!Object=} opt_event Object with details about the event.
   * @param {number=} opt_iterations Number of recursive expansions to perform.
   *    Defaults to 2 substitutions.
   * @param {boolean=} opt_encode Used to determine if the vars should be
   *    encoded or not. Defaults to true.
   * @return {!Promise<!string>} The expanded string.
   */
  expandTemplate(template, trigger, config, opt_event, opt_iterations,
      opt_encode) {
    opt_iterations = opt_iterations === undefined ? 2 : opt_iterations;
    opt_encode = opt_encode === undefined ? true : opt_encode;
    if (opt_iterations < 0) {
      user().error(TAG, 'Maximum depth reached while expanding variables. ' +
          'Please ensure that the variables are not recursive.');
      return Promise.resolve(template);
    }

    let replacementPromise;
    let replacement = template.replace(/\${([^}]*)}/g, (match, key) => {
      // TODO (avimehta): The parsing for variables breaks when `|` is used as
      // something other than the filter separator. A full-fledged parser would
      // be needed to fix this.

      const tokens = key.split('|');
      if (!tokens[0]) {
        return Promise.resolve('');
      }

      const {name, argList} = this.getNameArgs_(tokens[0].trim());
      // Precedence is opt_event.vars > trigger.vars > config.vars.
      const raw = (opt_event && opt_event['vars'] && opt_event['vars'][name]) ||
          (trigger['vars'] && trigger['vars'][name]) ||
          (config['vars'] && config['vars'][name]) ||
          '';

      let p;
      if (typeof raw == 'string') {
        p = this.expandTemplate(raw, trigger, config,
            opt_event, opt_iterations - 1);
      } else {
        // Values can also be arrays and objects. Don't expand them.
        p = Promise.resolve(raw);
      }

      p = p.then(expandedValue =>
          // First apply filters
          this.applyFilters_(expandedValue, tokens.slice(1)))
        .then(finalRawValue => {
          // Then encode the value
          const val = opt_encode
              ? this.encodeVars(finalRawValue, name)
              : finalRawValue;
          return val ? val + argList : val;
        })
        .then(encodedValue => {
          // Replace it in the string
          replacement = replacement.replace(match, encodedValue);
        });

      // Queue current replacement promise after the last replacement.
      if (replacementPromise) {
        replacementPromise = replacementPromise.then(() => p);
      } else {
        replacementPromise = p;
      }

      // Since the replacement will happen later, return the original template.
      return match;

    });

    // Once all the promises are complete, return the expanded value.
    if (replacementPromise) {
      replacementPromise = replacementPromise.then(() => replacement);
    }
    return replacementPromise || Promise.resolve(replacement);
  }

  /**
   * Returns an array containing two values: name and args parsed from the key.
   *
   * @param {string} key The key to be parsed.
   * @return {!Object<string>}
   * @private
   */
  getNameArgs_(key) {
    if (!key) {
      return {name: '', argList: ''};
    }
    const match = key.match(/([^(]*)(\([^)]*\))?/);
    if (!match) {
      user().error(TAG, 'Variable with invalid format found: ' + key);
    }
    return {name: match[1], argList: match[2] || ''};
  }

  /**
   * @param {string|!Array<string>} raw The values to URI encode.
   * @param {string} unusedName Name of the variable.
   * @return {string} The encoded value.
   */
  encodeVars(raw, unusedName) {
    if (!raw) {
      return '';
    }

    if (isArray(raw)) {
      return raw.map(encodeURIComponent).join(',');
    }
    // Separate out names and arguments from the value and encode the value.
    const {name, argList} = this.getNameArgs_(String(raw));
    return encodeURIComponent(name) + argList;
  }


  /**
   * @param  {string} value
   * @return {!Promise<!string>}
   */
  hashFilter_(value) {
    if (this.crypto_) {
      return this.crypto_.sha384Base64(user().assertString(value));
    }
    dev().error(TAG, 'Crypto library not found');
    return Promise.resolve('');
  }
}


/**
 * @param {!Window} win
 * @return {!VariableService}
 */
export function variableServiceFor(win) {
  return fromClass(win, 'amp-analytics-variables', VariableService);
}
