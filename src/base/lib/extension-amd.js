/*
  SystemJS AMD Format
  Provides the AMD module format definition at System.format.amd
  as well as a RequireJS-style require on System.require
*/
function amd(loader) {
  // by default we only enforce AMD noConflict mode in Node
  var isNode = typeof module != 'undefined' && module.exports;

  loader._extensions.push(amd);

  // AMD Module Format Detection RegEx
  // define([.., .., ..], ...)
  // define(varName); || define(function(require, exports) {}); || define({})
  var amdRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])define\s*\(\s*("[^"]+"\s*,\s*|'[^']+'\s*,\s*)?\s*(\[(\s*(("[^"]+"|'[^']+')\s*,|\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*(\s*("[^"]+"|'[^']+')\s*,?)?(\s*(\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*\s*\]|function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/;

  var strictCommentRegEx = /\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm
  var commentRegEx = /(\/\*([\s\S]*?)\*\/|([^:(?!\\)]|^)\/\/(.*)$)/mg;
  var stringRegEx = /("[^"\\\n\r]*(\\.[^"\\\n\r]*)*"|'[^'\\\n\r]*(\\.[^'\\\n\r]*)*')/g;
  var beforeRegEx = /(function|var|let|const|return|export|\"|\'|\(|\=)$/i
  var cjsRequirePre = "(?:^\\uFEFF?|[^$_a-zA-Z\\xA0-\\uFFFF.\"\'])";
  var cjsRequirePost = "\\s*\\(\\s*(\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|\'[^\'\\\\]*(?:\\\\.[^\'\\\\]*)*\')\\s*\\)";

  var fnBracketRegEx = /\(([^\)]*)\)/;
  var wsRegEx = /^\s+|\s+$/g;

  var requireRegExs = {};

  function getCJSDeps(source, requireIndex) {
    commentRegEx.lastIndex = stringRegEx.lastIndex = 0;
    var stringLocations = [], commentLocations = [];

    var match;

    function inLocation(locations, index) {
      for (var i = 0; i < locations.length; i++)
        if (locations[i][0] < index && locations[i][1] > index)
          return true;
      return false;
    }

    while (match = stringRegEx.exec(source))
      stringLocations.push([match.index, match.index + match[0].length]);

    while (match = commentRegEx.exec(source)) {
      // only track comments not starting in strings
      if (!inLocation(stringLocations, match.index + 1))
        commentLocations.push([match.index, match.index + match[0].length]);
    }

    // determine the require alias
    var params = source.match(fnBracketRegEx);
    var requireAlias = (params[1].split(',')[requireIndex] || 'require').replace(wsRegEx, '');

    // find or generate the regex for this requireAlias
    var requireRegEx = requireRegExs[requireAlias] || (requireRegExs[requireAlias] = new RegExp(cjsRequirePre + requireAlias + cjsRequirePost, 'g'));

    requireRegEx.lastIndex = 0;

    var deps = [];

    while (match = requireRegEx.exec(source)) {
      if(!inLocation(stringLocations, match.index) &&
        !inLocation(commentLocations, match.index)) {
        var dep = match[1].substr(1, match[1].length - 2);
        if(dep)
          deps.push(dep);
      }
    }

    return deps;
  }

  /*
    AMD-compatible require
    To copy RequireJS, set window.require = window.requirejs = loader.amdRequire
  */
  function require(names, callback, errback, referer) {
    // 'this' is bound to the loader
    var loader = this;

    // in amd, first arg can be a config object... we just ignore
    if (typeof names == 'object' && !(names instanceof Array))
      return require.apply(null, Array.prototype.splice.call(arguments, 1, arguments.length - 1));

    // amd require
    if (names instanceof Array)
      Promise.all(names.map(function(name) {
        return loader['import'](name, referer);
      })).then(function(modules) {
        if(callback) {
          callback.apply(null, modules);
        }
      }, errback);

    // commonjs require
    else if (typeof names == 'string') {
      var module = loader.get(names);
      return module.__useDefault ? module['default'] : module;
    }

    else
      throw new TypeError('Invalid require');
  };
  loader.amdRequire = function() {
    return require.apply(this, arguments);
  };

  function makeRequire(parentName, staticRequire, loader) {
    return function(names, callback, errback) {
      if (typeof names == 'string')
        return staticRequire(names);
      return require.call(loader, names, callback, errback, { name: parentName });
    }
  }

  // run once per loader
  function generateDefine(loader) {
    // script injection mode calls this function synchronously on load
    var onScriptLoad = loader.onScriptLoad;
    loader.onScriptLoad = function(load) {
      onScriptLoad(load);
      if (anonDefine || defineBundle) {
        load.metadata.format = 'defined';
        load.metadata.registered = true;
      }

      if (anonDefine) {
        load.metadata.deps = load.metadata.deps ? load.metadata.deps.concat(anonDefine.deps) : anonDefine.deps;
        load.metadata.execute = anonDefine.execute;
      }
    }

    function define(modName, modDeps, modFactory) {
      var name = modName;
      var deps = modDeps;
      var factory = modFactory;
      if (typeof name != 'string') {
        factory = deps;
        deps = name;
        name = null;
      }
      if (!(deps instanceof Array)) {
        factory = deps;
        deps = ['require', 'exports', 'module'];
      }

      if (typeof factory != 'function')
        factory = (function(factory) {
          return function() { return factory; }
        })(factory);

      // in IE8, a trailing comma becomes a trailing undefined entry
      if (deps[deps.length - 1] === undefined)
        deps.pop();

      // remove system dependencies
      var requireIndex, exportsIndex, moduleIndex;

      if ((requireIndex = indexOf.call(deps, 'require')) != -1) {

        deps.splice(requireIndex, 1);

        var factoryText = factory.toString();

        deps = deps.concat(getCJSDeps(factoryText, requireIndex));
      }


      if ((exportsIndex = indexOf.call(deps, 'exports')) != -1)
        deps.splice(exportsIndex, 1);

      if ((moduleIndex = indexOf.call(deps, 'module')) != -1)
        deps.splice(moduleIndex, 1);

      var define = {
        deps: deps,
        execute: function(require, exports, module) {

          var depValues = [];
          for (var i = 0; i < deps.length; i++)
            depValues.push(require(deps[i]));

          module.uri = loader.baseURL + module.id;

          module.config = function() {};

          // add back in system dependencies
          if (moduleIndex != -1)
            depValues.splice(moduleIndex, 0, module);

          if (exportsIndex != -1)
            depValues.splice(exportsIndex, 0, exports);

          if (requireIndex != -1)
            depValues.splice(requireIndex, 0, makeRequire(module.id, require, loader));

          var output = factory.apply(global, depValues);

          if (typeof output == 'undefined' && module)
            output = module.exports;

          if (typeof output != 'undefined')
            return output;
        }
      };

      // anonymous define
      if (!name) {
        // already defined anonymously -> throw
        if (anonDefine)
          throw new TypeError('Multiple defines for anonymous module');
        anonDefine = define;
      }
      // named define
      else {
        // if it has no dependencies and we don't have any other
        // defines, then let this be an anonymous define
        if (deps.length == 0 && !anonDefine && !defineBundle)
          anonDefine = define;

        // otherwise its a bundle only
        else
          anonDefine = null;

        // the above is just to support single modules of the form:
        // define('jquery')
        // still loading anonymously
        // because it is done widely enough to be useful

        // note this is now a bundle
        defineBundle = true;

        // define the module through the register registry
        loader.register(name, define.deps, false, define.execute);
      }
    };
    define.amd = {};
    loader.amdDefine = define;
  }

  var anonDefine;
  // set to true if the current module turns out to be a named define bundle
  var defineBundle;

  var oldModule, oldExports, oldDefine;

  // adds define as a global (potentially just temporarily)
  function createDefine(loader) {
    if (!loader.amdDefine)
      generateDefine(loader);

    anonDefine = null;
    defineBundle = null;

    // ensure no NodeJS environment detection
    var global = loader.global;

    oldModule = global.module;
    oldExports = global.exports;
    oldDefine = global.define;

    global.module = undefined;
    global.exports = undefined;

    if (global.define && global.define === loader.amdDefine)
      return;

    global.define = loader.amdDefine;
  }

  function removeDefine(loader) {
    var global = loader.global;
    global.define = oldDefine;
    global.module = oldModule;
    global.exports = oldExports;
  }

  generateDefine(loader);

  if (loader.scriptLoader) {
    var loaderFetch = loader.fetch;
    loader.fetch = function(load) {
      createDefine(this);
      return loaderFetch.call(this, load);
    }
  }

  var loaderInstantiate = loader.instantiate;
  loader.instantiate = function(load) {
    var loader = this,
      sourceWithoutComments = load.source.replace(strictCommentRegEx, '$1'),
      match = sourceWithoutComments.match(amdRegEx);

    if (load.metadata.format == 'amd' || !load.metadata.format && match) {

      // make sure that this is really a AMD module
      // get the content from beginning till the matched define block
      var sourceBeforeDefine = sourceWithoutComments.substring(0, sourceWithoutComments.indexOf(match[0])),
        trimmed = sourceBeforeDefine.replace(wsRegEx, "")

      // check if that there is no commen javscript keywork before
      if (!beforeRegEx.test(trimmed)) {
        load.metadata.format = 'amd';

        if (loader.execute !== false) {
          createDefine(loader);

          loader.__exec(load);

          removeDefine(loader);

          if (!anonDefine && !defineBundle && !isNode)
            throw new TypeError('AMD module ' + load.name + ' did not define');
        }

        if (anonDefine) {
          load.metadata.deps = load.metadata.deps ? load.metadata.deps.concat(anonDefine.deps) : anonDefine.deps;
          load.metadata.execute = anonDefine.execute;
        }
      }
    }

    return loaderInstantiate.call(loader, load);
  }
}
