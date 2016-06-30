'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.controlledTerm.controlledTermSearchDirective', [])
      .directive('controlledTermSearch', controlledTermSearchDirective);

  controlledTermSearchDirective.$inject = [];

  function controlledTermSearchDirective() {
    var directive = {
      bindToController: {
        fieldName : '=',
        searchMode: '=',
        //currentOntology    : '=',
        //currentValueSet    : '=',
        //includeCreateClass : '=',
        //resetCallback      : '=?',
        //selectedValueResult: '=',
      },
      controller      : controlledTermSearchDirectiveController,
      controllerAs    : 'tsc',
      restrict        : 'E',
      scope           : {},
      templateUrl     : 'scripts/controlled-term/controlled-term-search.directive.html'
    };

    return directive;

    controlledTermSearchDirectiveController.$inject = [
      '$q',
      '$rootScope',
      '$scope',
      'controlledTermDataService'
    ];

    function controlledTermSearchDirectiveController($q, $rootScope, $scope, controlledTermService, controlledTermDataService) {

      /* Variable declarations */
      var vm = this;
      vm.action = 'search';
      vm.loadingOntologies = false;
      vm.ontologySearchRegexp = null;
      vm.resultsFound = null;
      vm.searchFinished = null;
      vm.searchOntologiesResults = [];
      vm.searchScope = 'classes'; // Default search scope
      vm.showSearchPreloader = false;
      vm.showEmptyQueryMsg = false;
      vm.treeVisible = false;

      /* Function declarations */
      vm.changeSearchScope = changeSearchScope;
      vm.isEmptySearchQuery = isEmptySearchQuery;
      vm.isFieldTypesMode = isFieldTypesMode;
      vm.isFieldValuesMode = isFieldValuesMode;
      vm.isOntologyNameMatched = isOntologyNameMatched;
      vm.getDefaultSearchQuery = getDefaultSearchQuery;
      //vm.getSearchPlaceholderMessage = getSearchPlaceholderMessage;
      vm.isCurrentOntology = isCurrentOntology;
      vm.isSearchingClasses = isSearchingClasses;
      vm.isSearchingOntologies = isSearchingOntologies;
      vm.reset = reset;
      vm.search = search;
      vm.selectFieldClass = selectFieldClass;
      vm.selectFieldOntology = selectFieldOntology;
      //vm.searchQuery = vm.fieldName;
      vm.startSearch = startSearch;
      vm.endSearch = endSearch;

      /**
       * Search-related functions
       */

      function search(event) {
        vm.searchFinished = false;
        vm.resultsFound = null;
        //if (event) {
        //  event.preventDefault();
        //}
        if (isEmptySearchQuery() == false) {
          vm.showEmptyQueryMsg = false;
          if (isSearchingClasses()) {
            searchClasses();
          }
          //else if (isSearchingOntologies()) {
          //  searchOntologies();
          //}
          else if (isSearchingValueSets()) {
            searchValueSets();
          }
        }
        else {
          vm.showEmptyQueryMsg = true;
        }
      }

      function startSearch() {
        vm.searchFinished = false;
        vm.resultsFound = null;
        vm.showEmptyQueryMsg = false;
        vm.showSearchPreloader = true;
        vm.action = 'search';
      }

      function endSearch() {
        vm.searchFinished = true;
        //if (isEmptySearchQuery()) {
        //  vm.action = null;
        //}
      }

      function searchClasses() {
        startSearch();
        vm.searchClassesResults = [];
        var maxResults = 500;
        controlledTermDataService.searchClasses(vm.searchQuery, maxResults).then(function (response) {
          if (response.collection.length > 0) {
            var tArry = [], i;
            for (i = 0; i < response.collection.length; i += 1) {
              var ontology = controlledTermDataService.getOntologyByLdId(response.collection[i].source);
              // Ignore results for which the ontology was not found in the cache
              if (ontology) {
                tArry.push({
                  prefLabel: response.collection[i].prefLabel,
                  details  : response.collection[i],
                  ontology : ontology
                });
              }
            }
            vm.searchClassesResults = tArry;
            vm.resultsFound = true;
          } else {
            console.log("search results found false");
            vm.resultsFound = false;
          }

          // Hide 'Searching...' message
          vm.showSearchPreloader = false;
          endSearch();
        });
      }

      //function searchOntologies() {
      //  //vm.isSearchingOntologies = true;
      //  //vm.searchOntologiesResults = controlledTermDataService.getAllOntologies();
      //}

      function searchValueSets() {
        //vm.searchOntologiesResults = controlledTermDataService.getAllOntologies();
      }

      function getDefaultSearchQuery() {
        return isFieldTypesMode() ? vm.fieldName : '';
      }

      function changeSearchScope() {
        reset(true);
        if (isSearchingOntologies()) {
          loadOntologies();
        }
      }

      /**
       * Reset
       */
      function reset(keepSearchScope) {
        if (!keepSearchScope) {
          vm.searchScope = 'classes'; // Default search scope
        }
        vm.action = 'search';
        vm.ontologySearchRegexp = null;
        vm.resultsFound = null;
        vm.searchClassesResults = [];
        vm.searchFinished = null;
        //vm.searchOntologiesResults = [];
        vm.searchQuery = '';
        vm.showEmptyQueryMsg = false;
        vm.showSearchPreloader = false;
        vm.treeVisible = false;
        vm.ontologySearchRegexp = null;
      }

      /**
       * Other useful functions
       */

      function isFieldTypesMode() {
        return vm.searchMode == 'field' ? true : false;
      }

      function isFieldValuesMode() {
        return vm.searchMode == 'values' ? true : false;
      }

      function isSearchingClasses() {
        return vm.searchScope == 'classes' ? true : false;
      }

      function isSearchingOntologies() {
        return vm.searchScope == 'ontologies' ? true : false;
      }

      function isSearchingValueSets() {
        return vm.searchScope == 'value-sets' ? true : false;
      }

      function isEmptySearchQuery() {
        return (vm.searchQuery == '' || vm.searchQuery == null) ? true : false;
      }

      //function getSearchPlaceholderMessage() {
      //  if (isSearchingTerms()) {
      //    console.log("terms")
      //    return "Search for terms in BioPortal";
      //  }
      //  else if (isSearchingOntologies()) {
      //    console.log("ontologies")
      //    return "Search for ontologies in BioPortal";
      //  }
      //  else if (isSearchingValueSets()) {
      //    console.log("value-sets")
      //    return "Search for value sets in BioPortal";
      //  }
      //}

      /**
       * Ontology-related functions
       */

      function loadOntologies() {
        if (vm.searchOntologiesResults.length == 0) {
          vm.searchOntologiesResults = controlledTermDataService.getAllOntologies();
        }
      }

      function selectFieldClass(selection) {
        controlledTermService.loadTreeOfClass(selection, vm);
      }

      function selectFieldOntology(selection) {
        controlledTermService.loadOntologyRootClasses(selection, vm);
      }

      function isCurrentOntology() {
        return vm.currentOntology && vm.currentOntology != '';
      }

      function isOntologyNameMatched(ontology) {
        var name;
        if (!vm.isSearchingOntologies) {
          return ontology;
        }
        if (vm.ontologySearchRegexp) {
          name = ontology.name;
          return vm.ontologySearchRegexp.test(name);
        } else {
          return ontology;
        }
      }

      /**
       * Watch functions
       */

      /* Ensures that the fieldName search query is updated when the field name is updated */
      $scope.$watch(function () {
            return vm.fieldName;
          },
          function (value) {
            vm.fieldName = value;
            vm.searchQuery = getDefaultSearchQuery();
          });

      $scope.$watch(function () {
            return vm.searchQuery;
          },
          function () {
            if (vm.searchQuery) {
              vm.ontologySearchRegexp = new RegExp(vm.searchQuery, "i");
            } else {
              vm.searchQuery = null;
            }
          });
    }
  }
});

