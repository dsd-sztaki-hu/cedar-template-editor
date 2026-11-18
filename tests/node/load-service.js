'use strict';

// Loads an AngularJS service file under Node. The file calls define(), which
// registers the service function. That function is then called with the stubs.
function loadService(file, deps) {
    let factory = null;
    global.define = function (deps, fn) {
        fn({
            module: function () {
                return {
                    service: function (name, serviceFunction) {
                        factory = serviceFunction;
                    }
                };
            }
        });
    };
    delete require.cache[require.resolve(file)];
    require(file);
    return factory.apply(null, deps || []);
}

module.exports = {loadService};
