const crypto = require('crypto');
const request = require('request-promise');
const FS_URL = 'http://platform.fatsecret.com/rest/server.api';
const FS_API_KEY ='996f09e3e0874a9f82a94678bfb92f6e';
const FS_API_SECRET = 'a0625f6df15449c79131632a5898fa58';
const KIOSK_URL = 'http://18.202.126.35:8080/nutapp';
const nonce = require('nonce')();
const strictUriEncode = require('strict-uri-encode');

/* 
* API request methods to get data from the fat secret database and to also 
* make calls to the kiok server, uses a promise based request package as 
* we need to be able to use await on calls
**/
const handler = {
  searchFood: function(value) {
    return request.get({
        "uri": __createFatSecretURL([ 
          'method=foods.search',
          `search_expression=${strictUriEncode(value)}`
        ])
    });
  },
  getFood: function(value) {
    return request.get({
        "uri": __createFatSecretURL([ 
          'method=food.get',
          `food_id=${strictUriEncode(value)}`
        ])
    });
  },
  checkUserPin: function(pin) {
    return request.get({
      "uri": __createKioskURL([
        'user/checkuser',`${pin}`
      ])
    });
  },
  kioskScan: function(username, pin) {
    return request.get({
      "uri": __createKioskURL([
        'scan/runscan',`${username}`, `${pin}`
      ])
    });
  }
}

/* creates a url for a kiosk API request, returns complete url string */
function __createKioskURL(requestParameters) {
  var params = '';
  for(var i = 0; i < requestParameters.length; i++) {
    params += requestParameters[i];
    if(i < requestParameters.length - 1) {
      params += '/';
    }
  }
  console.log("KIOK URL GENERATED");
  console.log(KIOSK_URL + '/' + params);
  return KIOSK_URL + '/' + params;
}

/* -------------------- Fat secret API request builder functions  ------------------------ */
/* --------------------------------------------------------------------------------------- */

/* creates a url with correct encodings and appended signature, returns the url  
*  @param requestParameters - array containing API request parameters 
*  @return - the complete URL encoded request with signature appended 
**/
function __createFatSecretURL(requestParameters) {
    var parameters = __generateParams(requestParameters, nonce(), Date.now());
    var signature = __signOauth(__generateSigBase('GET', FS_URL, parameters));
    var reqString = FS_URL + '?' + parameters + '&oauth_signature=' + signature;
    return reqString;
}

/* generate the normalized parameters, '&' seperated key value pairs 
*  @param methodArray - array of request parameters with API method included
*  @param nonce - randomly generated string from for our nonce
*  @param ts - timestamp
*  @return - the & seperated string with the full set of oauth params and our
*            request parameters included
**/
function __generateParams(methodArray, nonce, ts) {
    var oauth = [
      'oauth_consumer_key=' + FS_API_KEY,
      'oauth_nonce=' + nonce,
      'oauth_signature_method=HMAC-SHA1',
      'oauth_timestamp=' + ts,
      'oauth_version=1.0',
      'format=json'
    ];
    var params = '';
    var joined = methodArray.concat(oauth).sort();
    for(var i = 0; i < joined.length; i++) {
      params += joined[i]; 
      if(i < joined.length - 1) {
        params += '&';
      }
    }
    return params.trim();
  }
  
  /* generate the signature base string from the method, url and normalized parameters 
  *  @param meth - the request method ie 'GET'
  *  @param url - the request url for the fat secret database
  *  @param params - our & seperated string with all oauth and request parameters
  *  @return - what we sign to actually get the signature that is appended to request
  **/
  function __generateSigBase(meth, url, params) {
    var s = meth + '&' + strictUriEncode(url) + '&' + strictUriEncode(params);
    return s.trim();
  }
  
  /* sign the signature base string using the HMAC-SHA1 hash function then url encode 
  *  @param str - the signature base string to be signed
  *  @return - the signed signature base string
  **/
  function __signOauth(str) {
    var hmac = crypto.createHmac('sha1', FS_API_SECRET + '&'); 
    hmac.update(str);
    str = strictUriEncode(hmac.digest('base64'));
    return str.trim();
  }

  module.exports = {
    handler
  };