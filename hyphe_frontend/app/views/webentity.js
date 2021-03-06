'use strict';

angular.module('hyphe.webentityController', [])

  .controller('webentity',
  function(
    $scope,
    api,
    utils,
    corpus,
    store,
    $location,
    $timeout
  ){
    $scope.currentPage = 'webentity'
    $scope.corpusName = corpus.getName()
    $scope.corpusId = corpus.getId()

    $scope.webentity = {id:utils.readWebentityIdFromRoute(), loading:true}

    $scope.identityEditMode = false
    $scope.identityEditLoading = false
    
    $scope.tagCategories = {}
    $scope.tagsPendingQueries = 0
    $scope.tagsAutocomplete = {}
    $scope.newCategory = ""

    $scope.crawls = []

    $scope.pages = []
    $scope.pagesLoading = true

    $scope.$watch('tagCategories', synchronizeTags, true)

    $scope.enableEditMode = function(){
      $scope.webentityEdit_name = $scope.webentity.name
      $scope.webentityEdit_status = $scope.webentity.status
      $scope.webentityEdit_homepage = $scope.webentity.homepage
      $scope.identityEditMode = true
      $scope.homepageErrorMessage = ''
    }

    $scope.disableEditMode = function(){
      $scope.identityEditMode = false
    }

    $scope.crawlDetails = function(job){
      $location.url('/project/'+$scope.corpusId+'/monitorCrawls?id='+job._id)
    }

    $scope.reCrawl = function(oldjob){
      var obj = {webentity: $scope.webentity}
      store.set('webentities_toCrawl', [obj])
      store.set('webentity_old_crawljob', oldjob)
      $location.path('/project/'+$scope.corpusId+'/prepareCrawls')
    }

    $scope.abortCrawl = function(job){
      if(job !== undefined){
        $scope.status = {message: 'Aborting crawl job'}
        job.crawling_status = 'CANCELED'
        utils.consolidateJob(job)
        api.abortCrawlJobs({
            id: job._id
          }, function(){
            $scope.status = {}
          }, function(){
            $scope.status = {message: 'Error aborting crawl job', background:'danger'}
          }
        )
      }
    }

    $scope.saveWebEntity = function(){
      var homepageValid = checkWebEntityHomepage($scope.webentityEdit_homepage)
      if (!homepageValid) {
        $scope.homepageErrorMessage = 'Invalid URL'
        return
      } else {
        $scope.homepageErrorMessage = ''
      }
      $scope.status = {message: 'Updating web entity'}
      $scope.identityEditLoading = true
      var settings = {
        webentityId: $scope.webentity.id
        ,name: $scope.webentityEdit_name
        ,status: $scope.webentityEdit_status
        ,homepage: $scope.webentityEdit_homepage
      }
      return api.webentityUpdate(
        settings
        ,function(result){
          $scope.status = {message: ''}
          $scope.identityEditLoading = false
          $scope.identityEditMode = false
          $scope.webentity.name = settings.name
          $scope.webentity.status = settings.status
          $scope.webentity.homepage = settings.homepage
          updateWELastModifTime()
        }
        ,function(error){
          $scope.status = {message: 'Web entity update failed', background:'warning'}
          $scope.identityEditLoading = false
        }
      )
    }

    $scope.saveNewCategory = function(){
      var category = $scope.newCategory.trim()
      if (!category || $scope.tagCategories[category]) return false
      if (~category.indexOf('.')) {
        $scope.status = {message: 'Tag categories cannot include dot characters', background: 'warning'}
        return false
      }
      $scope.tagCategories[category] = []
      
      // Wait a frame to render the new category before resetting the form field and focus on input
      $timeout(function(){
        $scope.newCategory = ''
      }, 0)
      
      return true
    }

    // Init
    api.downloadCorpusTLDs(function(){
      fetchWebentity()
      fetchCrawls()
      fetchAutocompletionTags()
      loadPages()
    })

    // Functions
    function loadPages(){
      $scope.pagesLoading = true
      $scope.status = {message: 'Load pages'}
      api.getPages({
          webentityId:$scope.webentity.id
        }
        ,function(result){
          $scope.pages = result
          $scope.pagesLoading = false
          $scope.status = {}
        }
        ,function(){
          $scope.pagesLoading = false
          $scope.status = {message: 'Error loading pages', background: 'danger'}
        }
      )
    }

    function synchronizeTags() {
      if ($scope.tagCategories && $scope.webentity.tags) {
        var comparison = {}
        var tagCat
        for (tagCat in $scope.tagCategories) {
          comparison[tagCat] = comparison[tagCat] || {}
          comparison[tagCat].new = $scope.tagCategories[tagCat]
        }
        for (tagCat in $scope.webentity.tags.USER) {
          comparison[tagCat] = comparison[tagCat] || {}
          comparison[tagCat].old = $scope.webentity.tags.USER[tagCat]
        }
        for (tagCat in comparison) {
          var tags = comparison[tagCat]
          var tagsToAdd = (tags.new || []).filter(function(tag){
            return (tags.old || []).indexOf(tag) < 0
          })
          var tagsToRemove = (tags.old || []).filter(function(tag){
            return (tags.new || []).indexOf(tag) < 0
          })
          tagsToAdd.forEach(function(tag){
            addTag(tag, tagCat)
          })
          tagsToRemove.forEach(function(tag){
            removeTag(tag, tagCat)
          })
        }
      }
    }

    function addTag(tag, category){
      $scope.status = {message: 'Adding tag'}
      $scope.tagsPendingQueries++
      $scope.webentity.tags.USER[category] = $scope.webentity.tags.USER[category] || []
      $scope.webentity.tags.USER[category].push(tag)
      
      return api.addTag({
          webentityId: $scope.webentity.id
          ,category: category
          ,value: tag
        }
        ,function(){
          $scope.tagsPendingQueries--
          $scope.status = {message: ''}
          updateWELastModifTime()
        }
        ,function(error){
          $scope.tagsPendingQueries--
          $scope.tagCategories[category] = $scope.tagCategories[category].filter(function(t){
            return t != tag
          })
          $scope.status = {message: 'Could not add tag', background:'warning'}
        }
      )
    }

    function removeTag(tag, category){
      $scope.status = {message: 'Removing tag'}
      $scope.tagsPendingQueries++
      $scope.webentity.tags.USER[category] = $scope.webentity.tags.USER[category].filter(function(t){
        return t != tag
      })

      return api.removeTag({
          webentityId: $scope.webentity.id
          ,category: category
          ,value: tag
        }
        ,function(){
          $scope.tagsPendingQueries--
          $scope.status = {message: ''}
          updateWELastModifTime()
        }
        ,function(error){
          $scope.tagsPendingQueries--
          $scope.tagCategories[category].push(tag)
          $scope.status = {message: 'Could not remove tag', background:'warning'}
        }
      )
    }

    function checkWebEntityHomepage(homepage){
      var lru
      try{
        lru = utils.URL_to_JSON_LRU(homepage)
      } catch(e){
        lru = ""
      }
      if (!lru || (lru.scheme !== "http" && lru.scheme !== "https")){
        return false
      }
      return true
    }

    function updateWELastModifTime(){
      $scope.webentity.last_modification_date = (new Date()).getTime()
    }

    function fetchWebentity(){
      api.getWebentities({
          id_list:[utils.readWebentityIdFromRoute()]
          ,crawledOnly: false
        }
        ,function(result){
          $scope.webentity = result[0]
          $scope.webentity.loading = false

          $scope.webentity.prefixes.sort(utils.sort_LRUs)
          $scope.webentity.tags.USER = $scope.webentity.tags.USER || {}
          $scope.webentity.tags.USER.FREETAGS = $scope.webentity.tags.USER.FREETAGS || []
          
          // Clone categories
          var tagCat
          for(tagCat in $scope.webentity.tags.USER) {
            $scope.tagCategories[tagCat] = $scope.webentity.tags.USER[tagCat].slice(0)
          }

          console.log($scope.webentity.name, $scope.webentity)
        }
        ,function(){
          $scope.status = {message: 'Error loading web entity', background: 'danger'}
        }
      )
    }

    function fetchCrawls(){
      api.webentityCrawlsList({
          webentityId: utils.readWebentityIdFromRoute()
        }
        ,function(result){
          $scope.crawls = result.map(utils.consolidateJob)
          $scope.crawls.sort(function(a, b){
            return b.created_at - a.created_at
          })
          if ($scope.crawls.some(function(job){
            return job.globalStatus != 'ACHIEVED' && job.globalStatus != 'UNSUCCESSFUL' && job.globalStatus != 'CANCELED'
          })) $timeout(fetchCrawls, 3000)
        }
        ,function(){
          $scope.status = {message: "Error loading web entity's crawls", background: 'danger'}
        }
      )
    }

    $scope.autoComplete = function(query, category){
      var searchQuery = searchable(query)
        , res = []
      Object.keys($scope.tagsAutocomplete[category] || {}).forEach(function(searchTag){
        if (searchTag && (!searchQuery || ~searchTag.indexOf(searchQuery))) {
          res.push($scope.tagsAutocomplete[category][searchTag])
        }
      })
      return res
    }

    function searchable(str){
      str = str.trim().toLowerCase()
      // remove diacritics
      var from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;"
          , to = "aaaaeeeeiiiioooouuuunc------"
      for (var i = 0, l = from.length; i < l; i++) {
        str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i))
      }
      return str
    }

    function fetchAutocompletionTags(){
      api.getTags(
        { namespace: 'USER' }
        ,function(data){
          var tagCat
          for (tagCat in data) {
            $scope.tagsAutocomplete[tagCat] = {}
            $scope.tagCategories[tagCat] = $scope.tagCategories[tagCat] || []
            var tag
            var tagCatValues = data[tagCat]
            for (tag in tagCatValues) {
              $scope.tagsAutocomplete[tagCat][searchable(tag)] = tag
            }
          }
        }
        ,function(data){
          $scope.status = {message: 'Error loading corpus tags', background: 'danger'}
        }
      )
    }

  })
