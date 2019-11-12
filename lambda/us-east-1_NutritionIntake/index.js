const Alexa = require('ask-sdk-core');
const apiRequest = require('./apiRequest');
const db = require('./dbconnect');
const alexadb = require("./alexadb");
const request = require('request');
const AWS = require('aws-sdk');
/* test */

/* get random response fom alexa as long as not equal to the last response 
*  @param lastRespone - string value of last response
*  @param arr - array with string options for new response
*  @return - new response string 
**/
function getRandom(lastResponse, arr) {
  var response = '';
  do {
    response = arr[Math.floor(Math.random() * (arr.length - 0)) + 0];
  } while (response === lastResponse);
  return response;
}

/* this function shuffles an array and returns the shuffled array
*  @param array - array to be shuffled
**/
function shuffleArray(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

/* checks whether a given slot exists and returns its value if so, otherwise returns false 
*  we check slot.resolutions first as synonyms resolve different than straight matches
*  @param request - alexa request object 
*  @param slotName - string value of the intent slot key
*  @return - false if invalid otherwise returns to lower cased string value of slot
**/
function isSlotValid(request, slotName) {
  var slot = request.intent.slots[slotName];
  var slotValue;
  if (slot && slot.resolutions) {
    console.log("MULTIPLE SLOT VALUES RETURNED");
    console.log(slot.resolutions.resolutionsPerAuthority[0]);
    console.log("VALUE: " + slot.resolutions.resolutionsPerAuthority[0].values[0].value.name);
    slotValue = slot.resolutions.resolutionsPerAuthority[0].values[0].value.name.toLowerCase();
    return slotValue;

  } else if (slot && slot.value) {
    slotValue = slot.value.toLowerCase();
    return slotValue;
  } else {
    return false;
  }
}

/* checks if request body has results, if not returns false, otherwise returns exact match 
*  or failing a match returns the top match 
*  @param body - the raw JSON body
*  @param searchExpression - the name of the food item to be checked against the results
*  @return - false if no results otherwise the object with the food item and serving data
**/
function searchJSON(body, searchExpression) {
  var json = JSON.parse(body);
  var foodName = "";
  var foodID = "";
  var exactMatch = 0;
  var searchResults = {};
  if (json.foods.total_results !== "0") {
    /* loop through set of results to find matching food item */
    for (var i = 0; i < json.foods.food.length; i++) {
      var obj = json['foods']['food'][i]['food_name'];
      if (obj.toLowerCase().trim() == searchExpression.toLowerCase().trim()) {
        exactMatch = 1;
        foodName = obj;
        foodID = json['foods']['food'][i]['food_id'];
        return searchResults = { name: foodName, ID: foodID, match: exactMatch };
      }
    } /* if we have results but no exact match we return the top result instead */
    if (exactMatch === 0) {
      searchResults = {
        name: json['foods']['food'][0]['food_name'],
        ID: json['foods']['food'][0]['food_id'],
        match: exactMatch
      };
    }
    return searchResults;
  }
  return false;
}

/* process and return the JSON for a food search result
*  @param body - the raw JSON body of our food result
*  @return - the food serving that is measured in grams for our food item
**/
function foodGetJSON(body) {
  var json = JSON.parse(body);
  var serving = json['food']['servings']['serving'];
  var searchResults = {
    name: json['food']['food_name'],
    food_id: json['food']['food_id'],
    food_type: json['food']['food_type'],
    serving: null,
    isArray: false
  };
  let len = json.food.servings.serving.length;
  if (len) {
    for (var i = 0; i < serving.length; i++) {
      /* TODO need to come up with better solution than just checking for grams */
      if (serving[i]['metric_serving_unit'] == "g") {
        searchResults.isArray = true;
        searchResults.serving = serving[i];
        return searchResults;
      }
    }
  } else { /* result only has one serving so return that */
    searchResults.serving = serving;
  }
  return searchResults;
}

/* calls a search for a given food item, returns a promise in order to make 
*  it possible to await results as API calls need to waited on 
*  @param value - the name of the food item to search the fat secret database for
*  @return - our food search results processed into a js object
**/
async function searchFoodItem(value) {
  let res_body;
  let results;
  try {
    res_body = await apiRequest.handler.searchFood(value);
    results = searchJSON(res_body, value);
    res_body = await apiRequest.handler.getFood(results.ID);
    results = foodGetJSON(res_body, value);
  } catch (err) {
    console.log("ERROR WITH FAT SECRET API CALL");
    console.log(err);
  }
  return new Promise(function (resolve, reject) {
    resolve(results);
  });
}

/* adds values to session state without deleting others, basically a neat 
*  wrapper for the alexa setSessionAttributes method 
*  @param values - object with our session values to be updated
*  @param handlerInput - alexa object needed to access existing session attributes
**/
function addSessionValues(values, handlerInput) {
  let session = handlerInput.attributesManager.getSessionAttributes();
  for (let name of Object.keys(session)) {
    if (values[name]) {
      session[name] = values[name];
    }
  }
  handlerInput.attributesManager.setSessionAttributes(session);
}

/* normalizes a results set to a given serving weight 
*  @param amount - amount in grams to normalize all food nutrients to
*  @param results - our food results object with serving nutrient data
*  @return - updated food item object with standardized nutrient amounts
*            as per given serving amount in param amount
**/
function normalizeWeights(amount, results) {
  var mod = parseFloat(amount) / parseFloat(results.serving.metric_serving_amount);
  if (results.metric_serving_unit === "oz") {
    mod = mod * 28.3495;
  }
  for (let key of Object.keys(results.serving)) {
    if (!isNaN(Number(results.serving[key])) && key != 'serving_id') {
      results.serving[key] = Number(results.serving[key]) * mod;
      results.serving[key] = Number(Math.round(results.serving[key] + 'e' + 2) + 'e-' + 2);
    }
  }
  return results;
}

/* builds a food search speech response based on if attribute is provided 
*  or upon a standard set of attributes zero values are ignored
*  @param results - object with our food item and serving information
*  @param handlerInput - alexa handlerInput interface
*  @param attribute - if user has specified a particular nutrient for food
*                     search we build around that, otherwise response is built
*                     around protein, carbs, sugar and fat if not 0
*  @return - string value with food search results to be said by alexa to user
**/

var proteinatt;
var fatatt;
var sugaratt;
var carbatt;
var caloriesatt;

function buildFoodSearchResponse(results, handlerInput, attribute) {
  const session = handlerInput.attributesManager.getSessionAttributes();
  /* we can randomise the start so responses are less repetive */
  var speechText = getRandom(session.lastFoodItemResponse, [
    'a ',
    ' ',
    'per ',
    'I found results for you, a ',
    'Search succesful, a '
  ]);
  speechText += `${Math.floor(results.serving.metric_serving_amount)} gram serving`;
  speechText += ` of ${results.name} contains`;
  var atts = ['protein', 'fat', 'sugar', 'carbohydrate', 'calories'];
  proteinatt = `${results.serving[atts[0]]}`;
  fatatt = `${results.serving[atts[1]]}`;
  sugaratt = `${results.serving[atts[2]]}`;
  carbatt = `${results.serving[atts[3]]}`;
  caloriesatt = `${results.serving[atts[4]]}`;
  if (!attribute) {
    for (var i = 0; i < atts.length; i++) {
      if (results.serving[atts[i]] != 0) {
        speechText += ` ${results.serving[atts[i]]} grams of ${atts[i]},`;
        //totalresults += `${results.serving[atts[i]]}`;
      }
    }
  } else {
    console.log("NUTRIENT AMOUNT: " + results.serving[attribute]);
    if (results.serving[attribute] != 0) {
      speechText += ` ${results.serving[attribute]}`;
      /* these are measured in milligrams not grams */
      if (attribute === 'sodium' || attribute === 'cholesterol') {
        speechText += ` milligrams of ${attribute.replace("_", " ").trim()}`;
      } else {
        speechText += ` grams of ${attribute.replace("_", " ").trim()},`;
      }
    } else {
      speechText += ` no ${attribute.replace("_", " ").trim()}`;
    }
  }
  return speechText;
}

/* creates a response string for the more information intent handler 
*  @param session - object containing all current session data
*  @param slotValue - the value of the nutrient slot we are building for
*  @return - the string value for the more info intent response 
**/
function buildMoreInfoResponse(session, slotValue) {
  let amount = Math.floor(session.lastFoodResult.serving['metric_serving_amount']);
  let value = session.lastFoodResult.serving[slotValue.replace(" ", "_").trim()];
  let name = session.lastFoodResult.name;
  let attAmount = 'grams';
  if (slotValue === 'sodium' || slotValue === 'cholesterol') {
    attAmount = 'milligrams';
  }
  let speechText = getRandom(session.lastMoreInfoResponse, [
    `it has ${value} ${attAmount} of ${slotValue} per ${amount} grams of ${name}`,
    `${amount} grams of ${name} has ${value} ${attAmount} of ${slotValue}`,
    `per ${amount} grams of ${name} there is ${value} ${attAmount} of ${slotValue}`
  ]);
  return speechText;
}

/* gets the current date in datetime format, returns the formatted string 
*  @return - datetime formatted current time
**/
function getDateTime() {
  let d = new Date();
  let datetime = '';
  let month = d.getMonth() + 1;
  return datetime = d.getFullYear() + '-' + month + '-' + d.getDate() + ' ' +
    d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds();
}

/* builds a sql insert statement from a variable length of parameters, returns sql string 
*  @param food - object with the food item and serving data we want to insert
*  @return - complete SQL string for inserting a food search result into DB
**/
function buildInsertStatement(food) {
  var fields = ['serving_amount', 'calcium', 'calories', 'carbohydrate', 'fat',
    'fiber', 'iron', 'monounsaturated_fat', 'polyunsaturated_fat',
    'potassium', 'protein', 'saturated_fat', 'sodium', 'sugar',
    'vitamin_a', 'vitamin_b', 'vitamin_c'];
  let head = `INSERT INTO favorites.Servings (food_id, date`;
  let body = `VALUES(${food.food_id}, "${getDateTime()}"`;
  for (var i = 0; i < fields.length; i++) {
    if (food.serving[fields[i]]) {
      head += `,${fields[i]}`;
      body += `,${food.serving[fields[i]]}`;
    }
  }
  head += ') ';
  body += ')';
  return head + body;
}

/* TODO - change to a merge instead of insert to do all in one check / insert 
* saves a food object to the database. First checks if item already exists
* @param food - object with food and serving data
* @return - result of sql insert
**/
async function saveSearchResult(food) {
  let results = null;
  let sql = `SELECT * FROM favorites.Foods WHERE food_id = ${food.food_id}`;
  try {
    results = await db.db_con.runQuery(sql);
    db.db_con.close();
  } catch (err) {
    console.log("ERROR with database query");
    console.log(err);
  }
  /* if food item does not exist create it in the Foods table */
  if (!results.length > 0) {
    sql = `INSERT INTO favorites.Foods (food_id, food_name, food_type) ` +
      `VALUES(${food.food_id}, "${food.name}", "${food.food_type}")`;
    try {
      results = await db.db_con.runQuery(sql);
      db.db_con.close();
    } catch (err) {
      console.log("ERROR with database query");
      console.log(err);
    }
    sql = buildInsertStatement(food);
    console.log("INSERTING SERVING INFO");
    console.log(sql);
    try {
      results = await db.db_con.runQuery(sql);
      db.db_con.close();
    } catch (err) {
      console.log("ERROR with database query");
      console.log(err);
    }
  }
  return results;
}

/* returns the gender of a value based on preconfigured values 
*  @param value - slot value to be compared against
*  @return - male if matched or female otherwise
**/
function getGender(value) {
  let m = ['he', 'boy', 'male', 'man'];
  for (let i = 0; i < m.length; i++) {
    if (m[i] === value) {
      return 'male';
    }
  }
  return 'female';
}

/* returns true if person age is valid otherwise false 
*  @param age - integer value to be validated
*  @return - true if valid, false otherwise
**/
function validAge(age) {
  if (age < 125 && age > 0) {
    return true;
  }
  return false;
}

/* creates and returns a speech string for the daily recommended intake for a given 
*  age and gender, data is retrieved from database
*  @param age - the integer value of a persons age
*  @param gender - string value either male or female
*  @return - the speechtext returned as a promise so function can be waited on
**/
async function createDailyIntakeResponse(age, gender) {
  let speechText = ''
  let results;
  try {
    results = await db.db_con.getDailyIntake(age, gender);
    db.db_con.close();
  } catch (err) {
    console.log(err);
  }
  speechText = '' +
    `a ${gender} of ${age} years should eat ${results[0].vegetables} servings of vegetables ` +
    `and legumes, ${results[0].fruit} servings of fruit, ${results[0].grains} servings of grains ` +
    `and cereals ${results[0].meat} servings of lean meat, fish, eggs, nuts, seeds, legumes, ` +
    `beans and ${results[0].dairy} servings of milk, yoghurt, cheese and alternatives`;
  let attr = { lastDailyIntakeResponse: speechText };
  return new Promise(function (resolve, reject) {
    resolve(speechText);
  });
}

/* ------------------- Our alexa handlers for the different intents ---------------------- */
/* --------------------------------------------------------------------------------------- */

/* alexa entrypoint when app is launched, generate random welcome message and set and open 
*  all session variables 
**/
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    let session = handlerInput.attributesManager.getSessionAttributes();
    let speechText = getRandom(session.lastWelcomeResponse, [
      'Hi, I can calculate your body mass, record meals or search for nutrtion information.'
    ]);

    var DisplayText = "<font size = '7'><b>WELCOME TO SMART NUTRITION</b></font>";
    /* formally declare and initialize our session variables */
    const attr = {
      lastFoodResult: null,
      lastFoodItemResponse: '',
      lastFoodItemPrompt: '',
      lastMoreInfoResponse: '',
      lastMoreInfoPrompt: '',
      lastRepeatResponse: '',
      lastHelpResponse: '',
      lastResponse: '',
      lastAgePrompt: '',
      lastGenderPrompt: '',
      lastDailyIntakeResponse: '',
      lastCancelResponse: '',
      lastStopResponse: '',
      lastNutrientPrompt: ''
    };

    // imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/BMIHELP.png";
    if (supportsDisplay(handlerInput)) {
      let imgURL = "https://source.unsplash.com/aO1jND20GHA/1200x800";
      const myImage = new Alexa.ImageHelper()
        .addImageInstance(imgURL)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withPrimaryText(DisplayText)
        .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate6',
        token: 'string',
        backButton: 'HIDDEN',
        title: 'Smart nutrition',
        backgroundImage: myImage,
        textContent: primaryText,
      }).addHintDirective("I'd like to record my meals");
    }

    handlerInput.attributesManager.setSessionAttributes(attr);
    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};


/* Laravel Function to input users */
function httpGet(info) {
  request.post({ url: 'https://ka1901.scem.westernsydney.edu.au/api/alexa/public/api/userdata', form: info }, function (err, httpResponse, body) {
    if (err) { return console.log(err); }
    console.log(body);
  });
}

/* Laravel Function to update users*/
function httpGetUpdate(info) {
  console.log("come this area1");
  request.post({ url: `https://ka1901.scem.westernsydney.edu.au/api/alexa/public/api/userdata/${info.name}`, form: info }, function (err, httpResponse, body) {
    if (err) { return console.log(err); }
    console.log(body);
  });
}

/* Laravel Function to input food data*/
function httpGet2(info) {
  request.post({ url: 'https://ka1901.scem.westernsydney.edu.au/api/alexa/public/api/fooddata', form: info }, function (err, httpResponse, body) {
    if (err) { return console.log(err); }
    console.log(body);
  });
}

/* Function to log meals (NOT WORKING) */
/*
const LogMealIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'LogMealIntent'
      && handlerInput.requestEnvelope.request !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let UserValue = isSlotValid(request, 'userID');
    let FoodValue = isSlotValid(request, 'Food');
    let speechText, attr, results, attributeValue;

    let userID = currentIntent.slots['userID'].value;
    let Food = currentIntent.slots['Food'].value;

    if(!UserValue) {
      speechText = 'Who is this?';
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('userID', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    } 

    if(!FoodValue) {
      speechText = getRandom(session.lastFoodItemPrompt, [
        'What food item would you like me to search for?',
        'Can you tell me the name of the food item you want searched for?',
        'Tell me the name if the food item you want searched for',
        'What was the food item you want searched for?',
        'I need the name of a food item to search for'
      ]);
      attr = {lastFoodItemPrompt: speechText}
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('Food', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    } 

    results = await searchFoodItem(currentIntent.slots['Food'].value);
    results = normalizeWeights("100", results); 
    speechText = buildFoodSearchResponse(results, handlerInput, attributeValue);
    attr = { 
      lastFoodItemResponse: speechText,
      lastFoodResult: results
    };
    speechText = 'Registering food!' + "Protein: " + proteinatt + " Fat: " + fatatt +  " Sugar: " + sugaratt + " Carbs: " + carbatt;
    var info = {
      userID:userID,
      Food:Food
    };

    httpGet2(info);
    addSessionValues(attr, handlerInput);
    try {
      saveSearchResult(results);
    } catch(err) {
      console.log(err);
    }
    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
}
*/

/* BMI Calculator for registered user (NOT WORKING)*/
/*
const RegisteredUserBMI = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'RegUserBMIintent'
      && handlerInput.requestEnvelope.request !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let nameValue = isSlotValid(request,'name');
    let speechText = '';
    let attr;
    const weight = 0;
    const height = 0;

    if(!nameValue){
      speechText = getRandom(session.lastUserPrompt, [
        'Hi there, Can I get your name so I can calculate your BMI?'
      ]);
      attr = {lastUserPrompt: speechText};
      addSessionValues(attr, handlerInput);

        return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('name', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
      }
  
    let name = currentIntent.slots['name'].value;


    request.get('https://ka1901.scem.westernsydney.edu.au/api/alexa/public/api/userdata/'+ name)
    .on('response', function(response) {
        weight = response.Weight;
        height = response.Height;
        
    });
  
try {
    const newHeight = height / 100;
    var bmi = weight / (newHeight * newHeight);
    const bmiRounded = Math.round(bmi * 10) / 10;
    let weightCategoryOutput = '';
    
    if(bmi < 18.5)
    {
        weightCategoryOutput = '. You are underweight.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/UwBMI";
    }
    else if (bmi >= 18.5 && bmi <= 24.9)
    {
        weightCategoryOutput = '. You have a healthy weight.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/hBMI";
    }
    else if (bmi > 24.9 &&  bmi <= 29.9)
    {
        weightCategoryOutput = '. You are overweight.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/ovBMI";
    }
    else if (bmi > 29.9 &&  bmi <= 34.9)
    {
        weightCategoryOutput = '. You are obese.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/oBMI";
    }
    else
    {
        weightCategoryOutput = '. You are extremely obese.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/oBMI";
    }
    bmidisplaytext = 'BMI : ' + bmiRounded;
    speechText = 'Your BMI is ' + bmiRounded + weightCategoryOutput
    } catch(err) {
      console.log(err);
    }
    if (supportsDisplay(handlerInput) ) {
      const myImage = new Alexa.ImageHelper()
      .addImageInstance(imgAddress)
      .getImage();
   
    const primaryText = new Alexa.RichTextContentHelper()
      .withSecondaryText(bmidisplaytext)
      .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'string',
        backButton: 'HIDDEN',
        backgroundImage:myImage,
        textContent: primaryText
      });
    }
  
      return handlerInput.responseBuilder
        .speak(speechText)
        .withShouldEndSession(false)
        .getResponse();
    },
  }
  */


/* Update user details */
const updateUserIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'updateUserIntent';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let ageValue = isSlotValid(request, 'age');
    let genderValue = isSlotValid(request, 'gender');
    let nameValue = isSlotValid(request, 'name');
    let weightValue = isSlotValid(request, 'weight');
    let heightValue = isSlotValid(request, 'height');
    let speechText = '';
    let attr;

    /* Firstly get name if not supplied already */
    if (!nameValue) {
      speechText = getRandom(session.lastNamePrompt, [
        'Awesome, Whats your first name?',
        'Cool, first name please.',
        'Can I get your first name?'
      ]);
      attr = { lastNamePrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('name', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    /* Get Gender of user */
    if (!genderValue) {
      speechText = getRandom(session.lastGenderPrompt, [
        'what is the gender of the person',
        'are we talking about a male or a female',
        'are you asking about a male or a female',
        'tell me if the person is a female or a male',
        'what gender is the person',
        'are they male or female'
      ]);
      attr = { lastGenderPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('gender', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    /* Take varying user input and assign it to something we can work with */
    genderValue = getGender(genderValue);

    /* Get Age of user */
    if (!ageValue) {
      speechText = getRandom(session.lastAgePrompt, [
        'Okay, How old are you?'
      ]);
      attr = { lastAgePrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('age', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    if (!weightValue) {
      speechText = getRandom(session.lastWeightPrompt, [
        'What is your weight in kilograms'
      ]);
      attr = { lastWeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('weight', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    if (!heightValue) {
      speechText = getRandom(session.lastHeightPrompt, [
        'How tall are you in centimeters?'
      ]);
      attr = { lastHeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('height', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    let name = currentIntent.slots['name'].value;
    let gender = genderValue;
    let age = currentIntent.slots['age'].value;
    let weight = currentIntent.slots['weight'].value;
    let height = currentIntent.slots['height'].value;

    var info = {
      age: age,
      name: name,
      weight: weight,
      gender: gender,
      height: height
    };
    httpGetUpdate(info);

    /* we have all values, get daily intake for database build response and speak */
    try {
      speechText = 'Successfully updated your details!'
    } catch (err) {
      console.log(err);
    }
    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
}
///////////////////////////////////////////

async function isValidUser(userFName) {
  let userQuery = "";
  let isValid = true;
  try {
    userQuery = await alexadb.db_con.getUser(userFName);
    alexadb.db_con.close();
  } catch (err) {
    console.log(err);
  }
  console.log("VALID user", userQuery);
  if (userQuery.length > 0) {
    isValid = true;
  } else {
    isValid = false;
  }
  return new Promise(function (resolve, reject) {
    resolve(isValid);
  });
}

async function getUserEmail(userFName) {
  let userQuery = "";
  let userEmail = "";
  try {
    userQuery = await alexadb.db_con.getUser(userFName);
    alexadb.db_con.close();
  } catch (err) {
    console.log(err);
  }
  console.log("VALID user", userQuery[0]);
  if (userQuery.length > 0) {
    userEmail = userQuery[0].email;
  } else {
    userEmail = -1;
  }
  return new Promise(function (resolve, reject) {
    resolve(userEmail);
  });
}

async function getUserWeight(userFName) {
  let userQuery = "";
  let userWeight = "";
  try {
    userQuery = await alexadb.db_con.getUserWeight(userFName);
    alexadb.db_con.close();
  } catch (err) {
    console.log(err);
  }
  console.log("VALID user weight", userQuery[0]);
  if (userQuery.length > 0) {
    userWeight = userQuery[0].weight;
  } else {
    userWeight = -1;
  }
  return new Promise(function (resolve, reject) {
    resolve(userWeight);
  });
}

async function isMealExisted(timestamp, mealType, email) {
  let query = "";
  let isExisted = false;
  try {
    query = await alexadb.db_con.getMeal(timestamp, mealType, email);
    alexadb.db_con.close();
  } catch (err) {
    console.log(err);
  }
  console.log("Check existed meal", query);
  if (query.length > 0) {
    isExisted = query[0].img;
  } else {
    isExisted = false;
  }
  return new Promise(function (resolve, reject) {
    resolve(isExisted);
  });
}

async function getIngredientsFat(email, foodName) {
  let query = "";
  try {
    query = await alexadb.db_con.getIngredients(email, foodName);
    alexadb.db_con.close();
  } catch (err) {
    console.log(err);
  }
 
  if (query.length > 0) {
    console.log("Check ingredients ", query);
  } else {
    query = -1;
  }
  return new Promise(function (resolve, reject) {
    resolve(query);
  });
}


const mealRecordIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'mealRecordIntent';
  },
  async handle(handlerInput) {
    console.log("IN mealRecordIntent");
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;

    const NEW_MEAL = "NEW_MEAL";
    const OVERWRITE_MEAL_YES = "OVERWRITE_MEAL_YES";
    const OVERWRITE_MEAL_CONFIRMATION = "OVERWRITE_MEAL_CONFIRMATION";
    const OVERWRITE_MEAL_IN_PROGRESS = "OVERWRITE_MEAL_IN_PROGRESS";
    const backgroundImgURL = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/smartNutritionBackground.jpg";

    let mealTypeValue = isSlotValid(request, 'mealType');
    let mealValue = isSlotValid(request, 'meal');
    let quantityValue = isSlotValid(request, 'quantity');
    let userValue = isSlotValid(request, 'user');
    let servingValue = isSlotValid(request, 'serving');
    let speechText = '';
    let attr, attributeValue;
    let mealStr = "";
    let results = null;

    let mealType = currentIntent.slots['mealType'].value;
    let meal = currentIntent.slots['meal'].value;
    let quantity = currentIntent.slots['quantity'].value;
    let user = currentIntent.slots['user'].value;
    let serving = currentIntent.slots['serving'].value;

    session.currentIntent = "MEAL_RECORD_INTENT";
    handlerInput.attributesManager.setSessionAttributes(session);
    if (!session.recordMealStatus) {
      session.recordMealStatus = NEW_MEAL;
      handlerInput.attributesManager.setSessionAttributes(session);
    } else if (currentIntent.slots['status'] !== undefined) {
      session.recordMealStatus = OVERWRITE_MEAL_IN_PROGRESS;
      handlerInput.attributesManager.setSessionAttributes(session);
    }

    if (mealType != null) {
      session.lastMealType = mealType;
      handlerInput.attributesManager.setSessionAttributes(session);
    }
    // user
    if (!session.lastUser) {
      if (!userValue) {
        speechText = 'Hello, what is your name?';

        if (supportsDisplay(handlerInput)) {
          const myImage = new Alexa.ImageHelper()
            .addImageInstance(backgroundImgURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(speechText)
            .getTextContent();

          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate6',
            token: 'string',
            backButton: 'HIDDEN',
            title: 'Smart nutrition',
            backgroundImage: myImage,
            textContent: primaryText,
          }).addHintDirective("John");
        }

        return handlerInput.responseBuilder
          .speak(speechText)
          .reprompt(speechText)
          //.addElicitSlotDirective('user', currentIntent)
          .withShouldEndSession(false)
          .getResponse();
      }

      console.log("USER: " + user);
      session.lastUser = user;
      handlerInput.attributesManager.setSessionAttributes(session);
    } else {
      user = session.lastUser;
    }

    // CHECK IF USER HAS REGISTERED AN ACCOUNT
    if (session.lastUser != null) {
      let isValid = await isValidUser(session.lastUser);
      if (!isValid) {
        speechText = `Hi ${session.lastUser}, you are not registered to our service. Please create an account on our website. Thank you.`
        if (supportsDisplay(handlerInput)) {
          const myImage = new Alexa.ImageHelper()
            .addImageInstance(backgroundImgURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(speechText)
            .withSecondaryText('http://ec2-3-230-51-121.compute-1.amazonaws.com/index.php')
            .getTextContent();

          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate6',
            token: 'string',
            backButton: 'HIDDEN',
            title: 'LOGIN',
            backgroundImage: myImage,
            textContent: primaryText,
          });
        }
        return handlerInput.responseBuilder
          .speak(speechText)
          .withShouldEndSession(false)
          .getResponse();
      } else {
        let userEmail = await getUserEmail(session.lastUser);
        if (userEmail != -1) {
          session.userEmail = userEmail;
          handlerInput.attributesManager.setSessionAttributes(session);
        } else {
          console.log("Can't retrieve user email");
        }
        
            let userWeight = await getUserWeight(session.lastUser);
    if (userWeight != -1) {
      session.userWeight = userWeight;
      handlerInput.attributesManager.setSessionAttributes(session);
    } else {
      console.log("Can't retrieve user weight");
    }
      }
    }

    
    // type of meal 
    console.log("Value: " + session.lastMealType);
    if (!session.lastMealRecord) {
      if (!session.lastMealType) {
        speechText = getRandom(session.lastMealTypePrompt, [
          'Hey ' + session.lastUser + '. Would you like to record your meal for breakfast, lunch or dinner?',
          'Welcome ' + session.lastUser + '. Are you recording your meal for breakfast, lunch or dinner',
          'Hello ' + session.lastUser + '. Would you like to log your meals for breakfast, lunch or dinner?'
        ]);

        attr = { lastMealTypePrompt: speechText };
        addSessionValues(attr, handlerInput);

        if (supportsDisplay(handlerInput)) {
          const myImage = new Alexa.ImageHelper()
            .addImageInstance(backgroundImgURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(speechText)
            .getTextContent();

          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate6',
            token: 'string',
            backButton: 'HIDDEN',
            title: 'Smart nutrition',
            backgroundImage: myImage,
            textContent: primaryText,
          }).addHintDirective("breakfast");
        }

        return handlerInput.responseBuilder
          .speak(speechText)
          //.addElicitSlotDirective('mealType', currentIntent)
          .withShouldEndSession(false)
          .getResponse();
      }
    }

    if (!session.lastMealType) {
      session.lastMealType = mealType;
      handlerInput.attributesManager.setSessionAttributes(session);
    }

    console.log(session.recordMealStatus);
    if (session.recordMealStatus == NEW_MEAL) {
      /* checks if meal is already recorded for today*/
      let d = new Date();
      let month = d.getMonth() + 1;
      let dateToQuery = d.getFullYear() + '-' + month + '-' + d.getDate();
      let getImgID = await isMealExisted(dateToQuery, session.lastMealType, session.userEmail);

      if (getImgID != false) {
        console.log(`${user} already recorded ${session.lastMealType} for ${dateToQuery}`);

        session.recordMealStatus = OVERWRITE_MEAL_CONFIRMATION;
        session.overwriteMealTime = dateToQuery;
        session.imgid = getImgID;
        handlerInput.attributesManager.setSessionAttributes(session);

        speechText = `Hello ${user}, you already recorded ${session.lastMealType} for today. Would you like to overwrite this meal?`;
        if (supportsDisplay(handlerInput)) {

          const myImage = new Alexa.ImageHelper()
            .addImageInstance(backgroundImgURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(speechText)
            .getTextContent();

          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate6',
            token: 'string',
            backButton: 'HIDDEN',
            title: 'Smart nutrition',
            backgroundImage: myImage,
            textContent: primaryText,
          }).addHintDirective("Yes");
        }
        return handlerInput.responseBuilder
          .speak(speechText)
          .withShouldEndSession(false)
          .getResponse();
      }
    } else {
      console.log("Query succeeded but there is no user record");
    }



    // meal
    if (!mealValue) {
      if (!session.lastMealRecord) {
        speechText = getRandom(session.lastMealPrompt, [
          'Welcome ' + session.lastUser + ', what did you have for ' + session.lastMealType + '?',
          'Hi ' + session.lastUser + ', what did you have for ' + session.lastMealType + '?',
          'Hello ' + session.lastUser + ', what meal did you have for ' + session.lastMealType + '?',
        ]);
      } else {
        speechText = getRandom(session.lastMealPrompt, [
          'Okay, what else did you have?',
          'Awesome, what else did you have?',
          'What dish have you had'
        ]);
      }
      attr = { lastMealPrompt: speechText };
      addSessionValues(attr, handlerInput);

      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('meal', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    let carbVar, fatVar, proVar, sugVar, caloriesVar;
    // var paramsFood = {
    //   TableName: 'MealIngredientsTable',
    //   Key: {
    //     "mealID": meal,
    //     "user": user,
    //   },
    //   ProjectionExpression: 'carb,fat,protein,sugar,calories',
    // };

    // console.log("meal " + meal + " user " + user);

    // let queryFood = await dynamoDB.get(paramsFood, function (err, data) {
    //   if (err) {
    //     console.log("QUERY FOOD ERROR " + err);
    //   } else {
    //     console.log("QUERY FOOD " + JSON.stringify(data));
    //   }
    // }).promise();
    
    let isCustomDish = await getIngredientsFat(session.userEmail, meal);

    let notExisting = 0;
    if (isCustomDish != -1) {
      console.log("Custom NUTRITION " + JSON.stringify(isCustomDish));
      carbVar = isCustomDish[0].carb;
      fatVar = isCustomDish[0].fat;
      proVar = isCustomDish[0].prot;
      caloriesVar = isCustomDish[0].cal;
    } else {
      console.log("Query succeeded but there is no meal record");
      // new section  
      notExisting = 1;

      if (!servingValue) {
        speechText = `How many grams in this meal?`;

        return handlerInput.responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('serving', currentIntent)
          .withShouldEndSession(false)
          .getResponse();
      }
    }

    // new section
    if (notExisting == 1) {
      results = await searchFoodItem(meal);
      results = await normalizeWeights(serving, results);
      buildFoodSearchResponse(results, handlerInput, attributeValue);

      carbVar = carbatt;
      fatVar = fatatt;
      proVar = proteinatt;
      sugVar = sugaratt;
      caloriesVar = caloriesatt;
    }

    /* These session variables are to hold each total of nutrition attributes */
    var protein, fat, sugar, carb, calories;
    if (session.protein) {
      protein = session.protein;
      fat = session.fat;
      sugar = session.sugar;
      carb = session.carb;
      calories = session.calories

      protein += Number(proVar);
      fat += Number(fatVar);
      sugar += Number(sugVar);
      carb += Number(carbVar);
      calories += Number(caloriesVar);
    } else {
      protein = Number(proVar);
      fat = Number(fatVar);
      sugar = Number(sugVar);
      carb = Number(carbVar);
      calories = Number(caloriesVar);
    }

    session.protein = protein;
    session.fat = fat;
    session.sugar = sugar;
    session.carb = carb;
    session.calories = calories;
    handlerInput.attributesManager.setSessionAttributes(session);

    if (session.lastMealRecord) {
      mealStr = session.lastMealRecord;
      mealStr = mealStr + ", " + meal;
    } else {
      mealStr = meal;
    }

    session.lastMealRecord = mealStr;
    handlerInput.attributesManager.setSessionAttributes(session);

    let anotherMealStr = getRandom(session.lastQuantityPrompt, [
      'Did you have anything else to add for ' + session.lastMealType + '?',
      'Are there anymore meals you want to record for ' + session.lastMealType + '?',
      'Any other meal you want to log for ' + session.lastMealType + '?',
      'Do you have any meals you want to record for ' + session.lastMealType + '?',
    ]);

    speechText = 'You had ' + meal + '. ' + anotherMealStr;

    // Display meal on screen with grams
    if (supportsDisplay(handlerInput)) {
      let itemURL = 'https://source.unsplash.com/featured/340x340/?' + meal;
      console.log("URL: " + itemURL);

      const backgroundImg = new Alexa.ImageHelper()
        .withDescription('background-img')
        .addImageInstance(backgroundImgURL)
        .getImage();

      const itemImg = new Alexa.ImageHelper()
        .withDescription('food-item')
        .addImageInstance(itemURL)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withPrimaryText(speechText)
        .getTextContent();

      let textTitle = session.lastMealType.toUpperCase();
      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'stringToken',
        backButton: 'HIDDEN',
        backgroundImage: backgroundImg,
        title: textTitle,
        image: itemImg,
        textContent: primaryText
      }).addHintDirective("Yes or no");
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Meal: ' + meal + ' Quantity: ' + quantity)
      .withShouldEndSession(false)
      .getResponse();
  },
};
////////////////////////////////////////////

/* Intent to add a user */
const AddUserIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AddUserIntent';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let ageValue = isSlotValid(request, 'age');
    let genderValue = isSlotValid(request, 'gender');
    let nameValue = isSlotValid(request, 'name');
    let weightValue = isSlotValid(request, 'weight');
    let heightValue = isSlotValid(request, 'height');
    let speechText = '';
    let attr;

    let name = currentIntent.slots['name'].value;
    let gender = genderValue;
    let age = currentIntent.slots['age'].value;;
    let weight = currentIntent.slots['weight'].value;
    let height = currentIntent.slots['height'].value;

    /* Firstly get name */
    if (!nameValue) {
      speechText = getRandom(session.lastNamePrompt, [
        'Awesome, Whats your first name?',
        'Cool, first name please.',
        'Can I get your first name?'
      ]);
      attr = { lastNamePrompt: speechText };
      addSessionValues(attr, handlerInput);

      //      imgAddress = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/USERREG";
      /*
            if (supportsDisplay(handlerInput) ) {
              const myImage = new Alexa.ImageHelper()
              .addImageInstance(imgAddress)
              .getImage();
           
            const primaryText = new Alexa.RichTextContentHelper()
              .withSecondaryText(speechText)
              .getTextContent();
      
              response.addRenderTemplateDirectiv.addRenderTemplateDirective({
                type: 'BodyTemplate2',
                token: 'string',
                backButton: 'HIDDEN',
                backgroundImage:myImage,
                textContent: primaryText
              });
      
              return handlerInput.responseBuilder
              .speak(speechText)
              .addElicitSlotDirective('name', currentIntent)
              .withShouldEndSession(false)
              .getResponse();
            }
            */
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('name', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    /* Get Gender of user */
    if (!genderValue) {
      speechText = getRandom(session.lastGenderPrompt, [
        'what is the gender of the person',
        'are we talking about a male or a female',
        'are you asking about a male or a female',
        'tell me if the person is a female or a male',
        'what gender is the person',
        'are they male or female'
      ]);
      attr = { lastGenderPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .withSimpleCard('Name: ' + name)
        .addElicitSlotDirective('gender', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    genderValue = getGender(genderValue);

    /* Get Age of user */
    if (!ageValue) {
      speechText = getRandom(session.lastAgePrompt, [
        'Okay, How old are you?'
      ]);
      attr = { lastAgePrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .withSimpleCard('Name: ' + name + '\n\u200b\n Gender: ' + gender)
        .addElicitSlotDirective('age', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    if (!weightValue) {
      speechText = getRandom(session.lastWeightPrompt, [
        'What is your weight in kilograms'
      ]);
      attr = { lastWeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .withSimpleCard('Name: ' + name + '\nGender: ' + gender + '\nAge : ' + age)
        .addElicitSlotDirective('weight', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    if (!heightValue) {
      speechText = getRandom(session.lastHeightPrompt, [
        'How tall are you in centimeters?'
      ]);
      attr = { lastHeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .withSimpleCard('Name: ' + name + '\nGender: ' + gender + '\nAge : ' + age + '\nWeight : ' + weight)
        .addElicitSlotDirective('height', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    var info = {
      age: age,
      name: name,
      weight: weight,
      gender: gender,
      height: height
    };
    httpGet(info);

    /* we have all values, get daily intake for database build response and speak */
    try {
      speechText = 'Adding user to database!'
    } catch (err) {
      console.log(err);
    }
    imgAddress = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/USERREG";

    if (supportsDisplay(handlerInput)) {
      const myImage = new Alexa.ImageHelper()
        .addImageInstance(imgAddress)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withSecondaryText(speechText)
        .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'string',
        backButton: 'HIDDEN',
        backgroundImage: myImage,
        textContent: primaryText
      });
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Name: ' + nameValue + '\nGender: ' + genderValue + '\nAge : ' + ageValue + '\nWeight : ' + weightValue + '\nHeight : ' + heightValue)
      .withShouldEndSession(false)
      .getResponse();
  },
};

/*
const YesNoIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.YesIntent' ||
         handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent');
  },
  handle(handlerInput) {
    let answer = 'yes';
    if(handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent'){
      answer = 'no';
    }
    let speechText = `Your answer is ${answer}`;

    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};
*/

/* BMI Calculator */
const BMIIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'BMIcalcIntent'
      && handlerInput.requestEnvelope.request !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let weightValue = isSlotValid(request, 'weight');
    let heightValue = isSlotValid(request, 'height');
    //let nameValue = isSlotValid(request,'name');
    let speechText = '';
    let attr;

    /*
        if(!nameValue){
          speechText = getRandom(session.lastUserPrompt, [
            'Are you a registered user?'
          ]);
          attr = {lastUserPrompt: speechText};
          addSessionValues(attr, handlerInput);
    
          imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/UwBMI";
    
          if (supportsDisplay(handlerInput) ) {
            const myImage = new Alexa.ImageHelper()
            .addImageInstance(imgAddress)
            .getImage();
         
          const primaryText = new Alexa.RichTextContentHelper()
            .withSecondaryText(speechText)
            .getTextContent();
    
            return handlerInput.responseBuilder
            .addRenderTemplateDirective({
              type: 'BodyTemplate2',
              token: 'string',
              backButton: 'HIDDEN',
              backgroundImage:myImage,
              textContent: primaryText
            })
            .speak(speechText)
            .getResponse();
          }
        }
        */
    /* Get Age of user */
    if (!weightValue) {
      speechText = getRandom(session.lastWeightPrompt, [
        'Okay great, to start off with: What is your weight in kilograms'
      ]);
      attr = { lastWeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('weight', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    /* Get height of user */
    if (!heightValue) {
      speechText = getRandom(session.lastHeightPrompt, [
        'Great, How tall are you in centimeters?'
      ]);
      attr = { lastHeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('height', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    let weight = currentIntent.slots['weight'].value;
    let height = currentIntent.slots['height'].value;

    try {
      const newHeight = height / 100;
      var bmi = weight / (newHeight * newHeight);
      const bmiRounded = Math.round(bmi * 10) / 10;
      let weightCategoryOutput = '';

      if (bmi < 18.5) {
        weightCategoryOutput = '. You are underweight.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/UwBMI";
      }
      else if (bmi >= 18.5 && bmi <= 24.9) {
        weightCategoryOutput = '. You have a healthy weight.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/hBMI";
      }
      else if (bmi > 24.9 && bmi <= 29.9) {
        weightCategoryOutput = '. You are overweight.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/ovBMI";
      }
      else if (bmi > 29.9 && bmi <= 34.9) {
        weightCategoryOutput = '. You are obese.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/oBMI";
      }
      else {
        weightCategoryOutput = '. You are extremely obese.';
        imgAddress = "https://ka1901.scem.westernsydney.edu.au/TRYIMAGES/oBMI";
      }
      bmidisplaytext = 'BMI : ' + bmiRounded;
      speechText = 'Your BMI is ' + bmiRounded + weightCategoryOutput
    } catch (err) {
      console.log(err);
    }
    if (supportsDisplay(handlerInput)) {
      const myImage = new Alexa.ImageHelper()
        .addImageInstance(imgAddress)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withSecondaryText(bmidisplaytext)
        .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'string',
        backButton: 'HIDDEN',
        backgroundImage: myImage,
        textContent: primaryText
      });
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
}


/* BMR Calculator */
const BMRIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'BMRcalcIntent'
      && handlerInput.requestEnvelope.request !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let weightValue = isSlotValid(request, 'weight');
    let heightValue = isSlotValid(request, 'height');
    let ageValue = isSlotValid(request, 'userage');
    let genderValue = isSlotValid(request, 'gender');
    let speechText = '';
    let attr;

    /* Get Age of user */
    if (!weightValue) {
      speechText = getRandom(session.lastWeightPrompt, [
        'Okay great, to start off with: What is your weight in kilograms'
      ]);
      attr = { lastWeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('weight', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    /* Get height of user */
    if (!heightValue) {
      speechText = getRandom(session.lastHeightPrompt, [
        'Awesome, How tall are you in centimeters?'
      ]);
      attr = { lastHeightPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('height', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    /* Get gender of user */
    if (!genderValue) {
      speechText = getRandom(session.lastGenderPrompt, [
        'Okay, What is your gender?'
      ]);
      attr = { lastGenderPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('gender', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    genderValue = getGender(genderValue);

    /* Get age of user */
    if (!ageValue) {
      speechText = getRandom(session.lastAgePrompt, [
        'Okay, How old are you?',
        'what age is the person',
        'how old is the person',
        'what age person are we talking about',
        'tell me how old the person is',
        'can you tell me how old the person is',
        'what is the age of the person',
        'what age are we talking about'
      ]);
      attr = { lastAgePrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('userage', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    let weight = currentIntent.slots['weight'].value;
    let height = currentIntent.slots['height'].value;
    let age = currentIntent.slots['userage'].value;
    let gender = genderValue;

    imgAddress = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/BMRlaunch";


    try {
      var bmr;
      var calc = (10 * weight) + (6.25 * height) - (5 * age);

      if (gender == "male") {
        bmr = calc + 5;
      }
      else if (gender == "female") {
        bmr = calc - 161;
      }
      speechText = 'Your BMR is ' + bmr + ' kilocalories';
    } catch (err) {
      console.log(err);
    }


    if (supportsDisplay(handlerInput)) {
      const myImage = new Alexa.ImageHelper()
        .addImageInstance(imgAddress)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withPrimaryText(speechText)
        .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'string',
        backButton: 'HIDDEN',
        backgroundImage: myImage,
        textContent: primaryText
      });
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
}

const RegisterFoodIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'RegisterFoodIntent'
      && handlerInput.requestEnvelope.request !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    const backgroundImgURL = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/smartNutritionBackground.jpg";
    let UserValue = isSlotValid(request, 'User');
    let FoodValue = isSlotValid(request, 'Food');
    let FirstIngredient = isSlotValid(request, 'Ingredient');
    let servingValue = isSlotValid(request, 'serving');
    let ingredientStr = '';
    let speechText = '';
    let attr, results, attributeValue;

    let food = currentIntent.slots['Food'].value;
    let serving = currentIntent.slots['serving'].value;
    let user = currentIntent.slots['User'].value;
    let ingredient = currentIntent.slots['Ingredient'].value;

    session.currentIntent = "INGREDIENTS_RECORD_INTENT";
    handlerInput.attributesManager.setSessionAttributes(session);

    /* Get name of user */
    if (!session.lastUser) {
      if (!UserValue) {
        speechText = getRandom(session.lastUserPrompt, [
          'Hi, Who am I speaking to?',
          'Hey, Can I get your name please?',
          'Hi there, What is your name please?',
          'Sure thing, Let me first get your name',
          'Awesome, let me first get your name',
          'Please state your first name'
        ]);
        attr = { lastUserPrompt: speechText };
        addSessionValues(attr, handlerInput);

        return handlerInput.responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('User', currentIntent)
          .withShouldEndSession(false)
          .getResponse();
      }
      session.lastUser = user;
      handlerInput.attributesManager.setSessionAttributes(session);
    }
    if (session.lastUser != null) {
      let isValid = await isValidUser(session.lastUser);
      if (!isValid) {
        speechText = `Hi ${session.lastUser},You are not registered. Please register an account on our website`;
        if (supportsDisplay(handlerInput)) {
          const myImage = new Alexa.ImageHelper()
            .addImageInstance(backgroundImgURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(speechText)
            .getTextContent();

          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate6',
            token: 'string',
            backButton: 'HIDDEN',
            title: 'LOGIN',
            backgroundImage: myImage,
            textContent: primaryText,
          });
        }
        return handlerInput.responseBuilder
          .speak(speechText)
          .withShouldEndSession(true)
          .getResponse();
      }  else {
       let userEmail = await getUserEmail(session.lastUser);
        if (userEmail != -1) {
          session.userEmail = userEmail;
          handlerInput.attributesManager.setSessionAttributes(session);
        } else {
          console.log("Can't retrieve user email");
        }
    }
    }
    /* Get Food of user */
    if (!session.lastIngredientRecord) {
      if (!FoodValue) {
        speechText = getRandom(session.lastFoodPrompt, [
          'Hello ' + session.lastUser + ', what meal would you like to register?',
          'Hey ' + session.lastUser + ', what is the name of the food?',
          'Welcome ' + session.lastUser + ', what is the name of the food you ate?',
          'Hi ' + session.lastUser + ', let me just get the name of the food please.',
          'Hey ' + session.lastUser + ', go ahead and tell me the food name please.'
        ]);
        attr = { lastFoodPrompt: speechText };
        addSessionValues(attr, handlerInput);
        return handlerInput.responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('Food', currentIntent)
          .withShouldEndSession(false)
          .getResponse();
      }
      session.lastFood = food;
      handlerInput.attributesManager.setSessionAttributes(session);
    }


    /* Get Ingredients of food */
    if (!FirstIngredient) {
      if (!session.lastIngredientRecord) {
        speechText = getRandom(session.NextIngredientPrompt, [
          'Lets start with the first ingredient',
          'Okay, what was the first ingredient?',
          'First ingredient?'
        ]);
      } else {
        speechText = getRandom(session.NextIngredientPrompt, [
          'Awesome, tell me the next ingredient',
          'Sounds good,what else would you like to add?',
          'Great, what else did you use?',
          `Okay, what is the next ingrdient for ${session.lastFood}`
        ]);
      }
      attr = { NextIngredientPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('Ingredient', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    if (!servingValue) {
      speechText = getRandom(session.lastServingPrompt, [
        'How many grams of ' + ingredient + '?',
        'What amount in grams of ' + ingredient + ' did you have?',
        'How many grams did you have in this ingredient?'
      ]);

      attr = { lastServingPrompt: speechText };
      addSessionValues(attr, handlerInput);

      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('serving', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }

    results = await searchFoodItem(ingredient);
    results = await normalizeWeights(serving, results);
    buildFoodSearchResponse(results, handlerInput, attributeValue);

    // These session variables are to hold each total of nutrition attributes 
    var protein, fat, sugar, carb, calories;
    if (session.protein) {
      protein = session.protein;
      fat = session.fat;
      sugar = session.sugar;
      carb = session.carb;
      calories = session.calories;

      protein += Number(proteinatt);
      fat += Number(fatatt);
      sugar += Number(sugaratt);
      carb += Number(carbatt);
      calories += Number(caloriesatt);
    } else {
      protein = Number(proteinatt);
      fat = Number(fatatt);
      sugar = Number(sugaratt);
      carb = Number(carbatt);
      calories = Number(caloriesatt);
    }

    session.protein = protein;
    session.fat = fat;
    session.sugar = sugar;
    session.carb = carb;
    session.calories = calories;
    handlerInput.attributesManager.setSessionAttributes(session);

    if (session.lastIngredientRecord) {
      ingredientStr = session.lastIngredientRecord;
      ingredientStr = ingredientStr + ", " + ingredient;
    } else {
      ingredientStr = ingredientStr + " " + ingredient;
    }

    let questions = getRandom(session.NextIngredientPrompt, [
      'Anything else?',
      'Anything else to add?',
      'Anything else in there?',
      'Are there any other ingredients?',
    ]);
    let foodString = "Ingredients for " + session.lastFood + " are " + ingredientStr
      + ". " + questions;

    session.lastIngredientRecord = ingredientStr;
    handlerInput.attributesManager.setSessionAttributes(session);

    // Display meal on screen with grams
    if (supportsDisplay(handlerInput)) {
      let itemURL;
      if (!session.ingredientURL) {
        itemURL = 'https://source.unsplash.com/featured/340x340/?' + session.lastFood;
        session.ingredientURL = itemURL;
        handlerInput.attributesManager.setSessionAttributes(session);
      } else {
        itemURL = session.ingredientURL;
      }
      console.log("URL: " + itemURL);

      const backgroundImg = new Alexa.ImageHelper()
        .withDescription('background-img')
        .addImageInstance(backgroundImgURL)
        .getImage();

      const itemImg = new Alexa.ImageHelper()
        .withDescription('food-item')
        .addImageInstance(itemURL)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withPrimaryText(foodString)
        .getTextContent();

      let textTitle = session.lastFood.toUpperCase();
      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'stringToken',
        backButton: 'HIDDEN',
        backgroundImage: backgroundImg,
        title: textTitle,
        image: itemImg,
        textContent: primaryText
      }).addHintDirective("Yes or no");
    }

    return handlerInput.responseBuilder
      .speak(foodString)
      .withShouldEndSession(false)
      .getResponse();
  },
}

/* food item search intent handler, validates whether or not the food slot 
*  is filled and then calls a function to search the fat secret database
**/
const FoodSearchIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'FoodSearchIntent'
      && handlerInput.requestEnvelope.request !== 'COMPLETED';
  },
  async handle(handlerInput) {
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    const weightValue = isSlotValid(request, 'weight')
    let attributeValue = isSlotValid(request, 'attribute');
    const session = handlerInput.attributesManager.getSessionAttributes();
    let speechText, attr, results;
    /* set serving size to default 100 grams if not set */
    if (request.dialogState === 'STARTED') {
      if (!weightValue) {
        currentIntent.slots['weight'].value = "100";
      }
      if (attributeValue) {
        attributeValue = attributeValue.replace(" ", "_").trim();
      }
    }
    /* if no food value is set */
    if (!currentIntent.slots['food'].value) {
      speechText = getRandom(session.lastFoodItemPrompt, [
        'What food item would you like me to search for?',
        'Can you tell me the name of the food item you want searched for?',
        'Tell me the name if the food item you want searched for',
        'What was the food item you want searched for?',
        'I need the name of a food item to search for',
        'I missed the name of the food item, please say again'
      ]);
      attr = { lastFoodItemPrompt: speechText }
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('food', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    /* we have a food item value, now search fat secret db and build speech response */
    results = await searchFoodItem(currentIntent.slots['food'].value);
    results = normalizeWeights(currentIntent.slots['weight'].value, results);
    speechText = buildFoodSearchResponse(results, handlerInput, attributeValue);
    attr = {
      lastFoodItemResponse: speechText,
      lastFoodResult: results
    };

    let total = Number(proteinatt) + Number(fatatt) + Number(sugaratt) + Number(carbatt);
    console.log(total);
    let pro = Math.round((proteinatt / total) * 100);
    let fat = Math.round((fatatt / total) * 100);
    let sug = Math.round((sugaratt / total) * 100);
    let carb = Math.round((carbatt / total) * 100);

    let proteinStr = `${pro.toString()} %`;
    let fatStr = `${fat.toString()} %`;
    let sugarStr = `${sug.toString()} %`;
    let carbStr = `${carb.toString()} %`;

    let pieChartURL = `https://image-charts.com/chart?cht=pd`
      + `&chs=600x600`
      + `&chdl=Protein|Fat|Sugar|Carbohydrartes`
      + `&chd=t:${pro},${fat},${sug},${carb}`
      + `&chl=${proteinStr}|${fatStr}|${sugarStr}|${carbStr}`

    var imgAddress = "https://chart.googleapis.com/chart?chco=1446A0|DB3069|F5D547|5B3758&chs=480x400&chf=bg,s,65432100&chd=t:";
    imgAddress += proteinatt;
    imgAddress += ",";
    imgAddress += fatatt;
    imgAddress += ","
    imgAddress += sugaratt;
    imgAddress += ","
    imgAddress += carbatt;
    imgAddress += "&cht=p&chl=Protein|Fat|Sugar|Carbs";

    console.log("CHART " + imgAddress);
    console.log("CHART 1 " + pieChartURL);
    var Displaytext = "Protein: " + proteinatt + " Fat: " + fatatt + " Sugar: " + sugaratt + " Carbs: " + carbatt;

    bimageaddr = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/graph";

    addSessionValues(attr, handlerInput);
    /* try {
      saveSearchResult(results);
    } catch (err) {
      console.log(err);
    } */

        if (supportsDisplay(handlerInput) ) {
          const myImage = new Alexa.ImageHelper()
            .addImageInstance(imgAddress)
            .getImage();
          
          const bimage = new Alexa.ImageHelper()
            .addImageInstance(bimageaddr)
            .getImage();
         
          const primaryText = new Alexa.RichTextContentHelper()
            .withSecondaryText(Displaytext)
            .getTextContent();
            
          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate2',
            token: 'string',
            backButton: 'HIDDEN',
            backgroundImage:bimage,
            image: myImage,
            title: `${results.name}`,
            textContent: primaryText
          });
        } 

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('food item request match found')
      .withShouldEndSession(false)
      .getResponse();
  },
};

/* intent that allows a user to query nutrient content of a previous food search */
const MoreInformationIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'MoreInformationIntent';
  },
  handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const slotValue = isSlotValid(handlerInput.requestEnvelope.request, "attribute");
    let speechText = '';
    let attr;

    if (session.lastFoodResult !== null) {
      if (slotValue) {
        speechText = buildMoreInfoResponse(session, slotValue, handlerInput);
        attr = { lastMoreInfoResponse: speechText };
        addSessionValues(attr, handlerInput);
        return handlerInput.responseBuilder
          .speak(speechText)
          .withSimpleCard('More information intent', speechText)
          .withShouldEndSession(false)
          .getResponse();

      } else if (!slotValue) {
        speechText = getRandom(session.lastMoreInfoResponse, [
          'Please repeat the name of the food nutrient you want to know about',
          'Please say the name of the food attribute you want information on',
          'Can you repeat the name of the attribute again',
          'I did not hear the food attribute correctly, please repeat'
        ]);
        attr = { lastMoreInfoResponse: speechText };
        addSessionValues(attr, handlerInput);
        return handlerInput.responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('attribute')
          .withSimpleCard('More information intent', speechText)
          .withShouldEndSession(false)
          .getResponse();
      }
    }
    speechText = 'You need to search for a food item first';
    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('More information intent', speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

const WhatisBMIintentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'WhatisBMIintent';
  },
  handle(handlerInput) {
    let speechText = '';
    speechText = '' +
      'BMI stands for body mass index. It is a value derived from the weight and height of an individual.' +
      ' The BMI is an attempt to quantify the amount of tissue mass in an individual, and then categorize ' +
      'that person as underweight, normal weight, overweight, or obese based on that value';

    imgAddress = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/BMIlaunch";
    if (supportsDisplay(handlerInput)) {
      const myImage = new Alexa.ImageHelper()
        .addImageInstance(imgAddress)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withSecondaryText(speechText)
        .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate2',
        token: 'string',
        backButton: 'HIDDEN',
        backgroundImage: myImage,
        textContent: primaryText
      });
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('More information intent', speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

const WhatisBMRintentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'WhatisBMRintent';
  },
  handle(handlerInput) {
    let speechText = '';
    speechText = '' +
      'BMR stands for Basal Metabolic Rate. It is also knownn as Recommended Daily intake. It is the ' +
      'total number of calories that your body needs to perform basic life-sustaining functions. The BMR ' +
      'recommends the amount of kilocalories you should consume according to your age, gender, weight and ' +
      'height. This will ensure you’re getting an adequate amount of energy from your overall diet';

    imgAddress = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/FinalBMR2";
    if (supportsDisplay(handlerInput)) {
      const myImage = new Alexa.ImageHelper()
        .addImageInstance(imgAddress)
        .getImage();

      const primaryText = new Alexa.RichTextContentHelper()
        .withSecondaryText(speechText)
        .getTextContent();

      handlerInput.responseBuilder.addRenderTemplateDirective({
        type: 'BodyTemplate1',
        token: 'string',
        backButton: 'HIDDEN',
        backgroundImage: myImage,
        textContent: primaryText
      });
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('More information intent', speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

/* intent that allows the user to ask about the recommended daily intake for a given
*  age and gender. Utterances can trigger without the age and gender being given so
*  we need to validate each before building response 
**/
const DailyNutrientIntakeIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'DailyNutrientIntake';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let ageValue = isSlotValid(request, 'age');
    let genderValue = isSlotValid(request, 'gender');
    let speechText = '';
    let attr;
    /* if we dont have a value for the gender value yet */
    if (!genderValue) {
      speechText = getRandom(session.lastGenderPrompt, [
        'what is the gender of the person',
        'are we talking about a male or a female',
        'are you asking about a male or a female',
        'tell me if the person is a female or a male',
        'what gender is the person',
        'are they male or female'
      ]);
      attr = { lastGenderPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('gender', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    genderValue = getGender(genderValue);

    /* if we dont have a value for the age slot yet */
    if (!ageValue) {
      speechText = getRandom(session.lastAgePrompt, [
        'what age is the person',
        'how old is the person',
        'what age person are we talking about',
        'tell me how old the person is',
        'can you tell me how old the person is',
        'what is the age of the person',
        'what age are we talking about'
      ]);
      attr = { lastAgePrompt: speechText };
      addSessionValues(attr, handlerInput);

      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('age', currentIntent)
        .withShouldEndSession(false)
        .getResponse();

    } else {
      /* check that our age is within valid range */
      if (!validAge(ageValue)) {
        speechText = getRandom(session.lastAgePrompt, [
          `${ageValue} is not a valid, repeat the age again please`,
          `${ageValue} is invalid, tell me the age again`
        ]);
        attr = { lastAgePrompt: speechText };
        addSessionValues(attr, handlerInput);

        return handlerInput.responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('age', currentIntent)
          .withShouldEndSession(false)
          .getResponse();
      }
    }
    /* we have all values, get daily intake for database build response and speak */
    try {
      speechText = await createDailyIntakeResponse(ageValue, genderValue, session);
    } catch (err) {
      console.log(err);
    }
    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

/* simple intent that allows user to ask what is a given food nutrient, information is 
*  stored in a database, could be extended in future to provide either more information
**/
const NutrientWhatIsHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'NutrientWhatIsIntent';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let nutValue = isSlotValid(request, 'nutrient');
    let speechText = '';
    let attr;

    if (!nutValue) {
      speechText = getRandom(session.lastNutrientPrompt, [
        `what nutrient do you want to know about`,
        `tell me the name of food nutrient`,
        `Can you give me the name of a food nutrient`,
        `what food nutrient are you asking about`
      ]);
      attr = { lastNutrientPrompt: speechText };
      addSessionValues(attr, handlerInput);
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('nutrient', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    try {
      results = await db.db_con.getNutrientInfo(nutValue, 'description');
      db.db_con.close();
    } catch (err) {
      console.log('ERROR WITH NUTRITION DB CALL')
      console.log(err);
    }
    speechText = results[0].description;
    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

/* simple intent that allows a user to ask what the best sources of a given food 
*  nutrient are. As with the above could be extended in future, data is stored in
*  database
**/
const NutrientWhereIsHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'NutrientWhereIsIntent';
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const currentIntent = handlerInput.requestEnvelope.request.intent;
    const request = handlerInput.requestEnvelope.request;
    let nutValue = isSlotValid(request, 'nutrient');
    let speechText = '';
    let results;
    let attr;

    if (!nutValue) {
      speechText = getRandom(session.lastNutrientPrompt, [
        `what nutrient do you want to know about`,
        `tell me the name of food nutrient`,
        `Can you give me the name of a food nutrient`,
        `what food nutrient are you asking about`
      ]);
      attr = { lastNutrientPrompt: speechText };
      addSessionValues(attr, handlerInput);

      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('nutrient', currentIntent)
        .withShouldEndSession(false)
        .getResponse();
    }
    try {
      results = await db.db_con.getNutrientInfo(nutValue, 'sources');
      db.db_con.close();
    } catch (err) {
      console.log('ERROR WITH NUTRITION DB CALL')
      console.log(err);
    }
    speechText = results[0].sources;
    return handlerInput.responseBuilder
      .speak(speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

/* custom help intent that allows a user to ask for help with a given area of the app
*  and to recieve info on how to interact with it
**/
const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'HelpIntent';
  },
  handle(handlerInput) {
    const intentRequest = handlerInput.requestEnvelope.request;
    const updatedIntent = handlerInput.requestEnvelope.request.intent;
    const slotValue = isSlotValid(intentRequest, "help");
    let speechText;

    /* check what last reponse was so no repeat, then generate random response */
    if (intentRequest.dialogState === "STARTED") {
      if (slotValue === false) {
        return handlerInput.responseBuilder
          .addDelegateDirective(updatedIntent)
          .getResponse();
      } else {
        return handlerInput.responseBuilder
          .addDelegateDirective()
          .getResponse();
      }
    } else if (intentRequest.dialogState != "COMPLETED") {
      return handlerInput.responseBuilder
        .addDelegateDirective()
        .getResponse();

    } else {
      switch (slotValue) {
        case "search":
        case "searching":
          speechText = '' +
            '<speak>To search for food, you can simply say “Alexa, can you search for Beef for me?”. You ' +
            'can replace “Beef” with essentially whatever you want <break time="20ms"/> like “Chicken Breast”' +
            ' or “Filet Mingnon”. You can also specify the weight for the food you want to search for.     ' +
            '<break time="1s"/>You could also search for nutrition information, like “what is Protein” for ' +
            'example. If you have any more questions not answered here, please consult the mobile app. </speak>';
          break;
        case "application":
          speechText = '' +
            '<speak>I can do many things for you: You can ask it to “Search for beef” and I can return with ' +
            'some basic nutritional information of that item. You can also ask for a specific attribute like,' +
            ' “what is the protein in that?” or “What is the protein value in Beef?” If you are talking to me ' +
            'from a kiosk, you can put your food in and ask me to “Scan the food”, if you have your Username ' +
            'and Pin the kiosk can scan your food. Psst. If you don’t have an account with us, or need your ' +
            'pin, you can use the mobile phone app to do that.  </speak>';
          break;
        case "nutrition":
          speechText = '<speak>I can give you dietary guidelines if you like, just ask me what the recommended ' +
            'daily intake for a person is. You can also ask me about a particular food nutrient, for example just ' +
            'ask me what is protein, or ask me where can I find protein</speak>';
          break;
        default:
          speechText = '' +
            '<speak>I can\'t help you with that unfortunately, please consult our mobile application if you ' +
            'have an issue with our alexa app. For another other issues with alexa, please visit the help ' +
            'pages on the Amazon web site.</speak>';
      }
      return handlerInput.responseBuilder
        .speak(speechText)
        .withShouldEndSession(false)
        .getResponse();
    }
  },
};

/* basic app stop handler with randomized output */
const StopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent';
  },
  handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const speechText = getRandom(session.lastHelpResponse, [
      'Thank you for using the nutrition monitoring system',
      'Ok, stopping now',
      'Closing the nutrition monitoring system',
      'Shutting down the nutrition monitoring system',
      'Ending now',
      'Finshing now',
      'Goodbye and thank you for using the nutrition monitoring system',
      'Goodbye'
    ]);
    const attr = { lastStopResponse: speechText };
    addSessionValues(attr, handlerInput);
    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Stop intent', speechText)
      .withShouldEndSession(true)
      .getResponse();
  },
};

const YesIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.YesIntent');
  },
  handle(handlerInput) {
    console.log('In YesIntentlHandler');

    const session = handlerInput.attributesManager.getSessionAttributes();
    if (session.currentIntent == "MEAL_RECORD_INTENT") {
      if (session.recordMealStatus == "OVERWRITE_MEAL_CONFIRMATION") {
        return handlerInput.responseBuilder
          .withShouldEndSession(false)
          .addDelegateDirective({
            name: 'mealRecordIntent',
            slots: {
              mealType: {
                name: 'mealType',
                value: session.lastMealType
              },
              user: {
                name: 'user',
                value: session.lastUser
              },
              meal: {
                name: 'meal'
              },
              quantity: {
                name: 'quantity'
              },
              serving: {
                name: 'serving'
              },
              status: {
                name: 'status',
                value: 'OVERWRITE_MEAL_YES'
              }
            }
          })
          .getResponse();
      } else {
        return handlerInput.responseBuilder
          .withShouldEndSession(false)
          .addDelegateDirective({
            name: 'mealRecordIntent',
            slots: {
              mealType: {
                name: 'mealType',
                value: session.lastMealType
              },
              user: {
                name: 'user',
                value: session.lastUser
              },
              meal: {
                name: 'meal'
              },
              serving: {
                name: 'serving'
              },
              quantity: {
                name: 'quantity'
              },
            }
          })
          .getResponse();
      }
    } else if (session.currentIntent == "INGREDIENTS_RECORD_INTENT") {
      return handlerInput.responseBuilder
        .withShouldEndSession(false)
        .addDelegateDirective({
          name: 'RegisterFoodIntent',
          slots: {
            User: {
              name: 'User',
              value: session.lastUser
            },
            Food: {
              name: 'Food',
              value: session.lastFood
            },
            Ingredient: {
              name: 'Ingredient'
            },
            serving: {
              name: 'serving'
            }
          }

        })
        .getResponse();
      // Saying yes to keep recording ingredients
    }
  }
}

async function getNumRows() {
  let numRowsQuery = "";
  let numRows = 0;
  try {
    numRowsQuery = await alexadb.db_con.getNumRows();
    alexadb.db_con.close();
  } catch (err) {
    console.log(err);
  }
  console.log("Num rows", numRowsQuery[0]);
  if (numRowsQuery.length > 0) {
    numRows = numRowsQuery[0].id;
  } else {
     numRows = -1;
  }
  return new Promise(function (resolve, reject) {
    resolve(numRows);
  }); 
}

/* IF THE USER SAYS NO AFTER AGREE TO AN OVERWRITE, UPDATE OR PUT ITEMS IN DYNAMODB.
IF THE USER SAYS NO TO OVERWRITE, END THE SESSION
*/
const NoIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent';
  },
  async handle(handlerInput) {
    console.log('In NoOverwriteMealHandler');

    const backgroundImgURL = "https://ka1901.scem.westernsydney.edu.au/MAINIMAGES/smartNutritionBackground.jpg";
    let session = handlerInput.attributesManager.getSessionAttributes();

    console.log("I " + session.currentIntent + " " + session.recordMealStatus);
    let speechText = "";
    if (session.currentIntent == "MEAL_RECORD_INTENT" || session.currentIntent == "INGREDIENTS_RECORD_INTENT") {
      if (session.recordMealStatus == "OVERWRITE_MEAL_CONFIRMATION") {
        session.overwriteMealTime = "";
        handlerInput.attributesManager.setSessionAttributes(session);
        speechText = "What meal would you like to record?";
        if (supportsDisplay(handlerInput)) {

          const myImage = new Alexa.ImageHelper()
            .addImageInstance(backgroundImgURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(speechText)
            .getTextContent();

          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate6',
            token: 'string',
            backButton: 'HIDDEN',
            title: 'Smart nutrition',
            backgroundImage: myImage,
            textContent: primaryText,
          }).addHintDirective("Breakfast");
        }
      } else {
        let rounded_prot = Math.round(session.protein *10)/10;
        let rounded_fat = Math.round(session.fat *10)/10;
        let rounded_carb = Math.round(session.carb *10)/10;
        let rounded_cal = Math.round(session.calories *10)/10;
        
        var total = session.protein + session.fat  + session.carb;
        var pro = Math.round((session.protein / total) * 100);
        var fat = Math.round((session.fat / total) * 100);
        var carb = Math.round((session.carb / total) * 100);

        let caloriesStr = `${rounded_cal.toString()} cal`;
        let proteinStr = `${pro.toString()} %`;
        let fatStr = `${fat.toString()} %`;
        let carbStr = `${carb.toString()} %`;
        
        let totalProtein = `${rounded_prot} grams`;
        let totalFat = `${rounded_fat} grams`;
        let totalCarb = `${rounded_carb} grams`;
        let totalCal = `${rounded_cal} calories`;

        speechText = 'Total protein is ' + totalProtein + '. Total fat is ' +
          totalFat + '. Total carbohydrate is ' + totalCarb + '. Total calories is ' + totalCal + '.';

        let textToDisplay = `<b>NUTRITION INFORMATION:</b><br/><br/>`
          + `Protein:  ${totalProtein}<br/>`
          + `Fat:      ${totalFat}<br/>`
          + `Carbs:    ${totalCarb}<br/>`
          + `Calories: ${totalCal}`;


        // Display meal on screen with  quantity
        if (supportsDisplay(handlerInput)) {
          let pieChartURL = `https://image-charts.com/chart?cht=pd`
            + `&chs=600x600`
            + `&chli=${caloriesStr}`
            + `&chdl=Protein|Fat|Carbohydrartes`
            + `&chd=t:${pro},${fat},${carb}`
            + `&chl=${proteinStr}|${fatStr}|${carbStr}`

          console.log("PIE " + pieChartURL);

          const backgroundImg = new Alexa.ImageHelper()
            .withDescription('background-img')
            .addImageInstance(backgroundImgURL)
            .getImage();

          const itemImg = new Alexa.ImageHelper()
            .withDescription('food-item')
            .addImageInstance(pieChartURL)
            .getImage();

          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(textToDisplay)
            .getTextContent();

          let mealTitle = '';
          if (session.currentIntent == "MEAL_RECORD_INTENT") {
            let mealTypeStr = session.lastMealType;
            mealTitle = mealTypeStr.toUpperCase();
          } else if (session.currentIntent == "INGREDIENTS_RECORD_INTENT") {
            let lastFoodStr = session.lastFood;
            mealTitle = lastFoodStr.toUpperCase();
          }
          handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'BodyTemplate2',
            token: 'stringToken',
            backButton: 'HIDDEN',
            backgroundImage: backgroundImg,
            title: mealTitle,
            image: itemImg,
            textContent: primaryText
          }).addHintDirective("I'd like to record my meal");
        }

        let da = new Date();
        let month = da.getMonth() + 1;
        let dateToQuery = da.getFullYear() + '-' + month + '-' + da.getDate();
        console.log("TIME" + da.toString());
        
        if (session.currentIntent == "MEAL_RECORD_INTENT") {
          if (session.recordMealStatus == "OVERWRITE_MEAL_IN_PROGRESS") {
            try {
              await alexadb.db_con.updateSQLNutrition(session.imgid, session.lastMealRecord, session.userEmail, rounded_cal, 
              rounded_fat, rounded_carb, rounded_prot, dateToQuery, session.lastMealType);
              alexadb.db_con.close();
            } catch (err) {
              console.log(err);
            }
          } else if (session.recordMealStatus == "NEW_MEAL") {
            let timeToPut = da.getHours() + ':' + da.getMinutes() + ':' + da.getSeconds();
            let timestamp = dateToQuery + " " + timeToPut;
            let imgid = await getNumRows();
            imgid = imgid + 1;
            try {
              await alexadb.db_con.insertSQLNutrition(imgid, session.lastMealRecord, session.userEmail, rounded_cal, 
              rounded_fat, rounded_carb, rounded_prot, timestamp, session.lastMealType, session.userWeight);
              alexadb.db_con.close();
            } catch (err) {
              console.log(err);
            }
           
          }
        } else if (session.currentIntent == "INGREDIENTS_RECORD_INTENT") {
           try {
              await alexadb.db_con.insertIngredients(session.userEmail, session.lastFood, session.lastIngredientRecord,
                                                      rounded_cal, rounded_fat, rounded_carb, rounded_prot);
              alexadb.db_con.close();
            } catch (err) {
              console.log(err);
            }

        }
      }
    }

    // Reset all session attribute 
    let tempUser = session.lastUser;
    handlerInput.attributesManager.setSessionAttributes({});

    session = handlerInput.attributesManager.getSessionAttributes();
    // Restore session attribute for last user
    session.lastUser = tempUser;
    handlerInput.attributesManager.setSessionAttributes(session);

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Finished recording meals. Thank you.', speechText)
      .withShouldEndSession(false)
      .getResponse();
  },
};

/* standard cancel intent, only added randomized speech and a do not end session directive */
const CancelIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent');
  },
  async handle(handlerInput) {
    const session = handlerInput.attributesManager.getSessionAttributes();
    const speechText = getRandom(session, [
      'Ok then',
      'Ok, canceling now',
      'Request canceled',
      'Canceling',
      'Canceled'
    ]);
    const attr = { lastCancelResponse: speechText };
    addSessionValues(attr, handlerInput);
    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Cancel intent', speechText)
      .withShouldEndSession(false)
      .getResponse();

  },
};

/* standard, not used unless something goes wrong with alexa service / lambda function */
const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}` +
      `${handlerInput.requestEnvelope.request.type} ${handlerInput.requestEnvelope.request.message}`);
    return handlerInput.responseBuilder.getResponse();
  },
};


/* standard alexa error intent handler */
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);
    return handlerInput.responseBuilder
      .speak('Sorry, I can\'t understand the command. Please say again.')
      .reprompt('Sorry, I can\'t understand the command. Please say again.')
      .getResponse();
  },
};

/* Function to check if there is a display on the device*/
function supportsDisplay(handlerInput) {
  var hasDisplay =
    handlerInput.requestEnvelope.context &&
    handlerInput.requestEnvelope.context.System &&
    handlerInput.requestEnvelope.context.System.device &&
    handlerInput.requestEnvelope.context.System.device.supportedInterfaces &&
    handlerInput.requestEnvelope.context.System.device.supportedInterfaces.Display
  return hasDisplay;

}

/* the lambda function entrypoint, this is where everything is assigned and actually run */
const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .addRequestHandlers(
    /* our custom built intent handlers */
    FoodSearchIntentHandler,
    RegisterFoodIntentHandler,
    MoreInformationIntentHandler,
    HelpIntentHandler,
    DailyNutrientIntakeIntentHandler,
    AddUserIntentHandler,
    BMIIntentHandler,
    NutrientWhatIsHandler,
    NutrientWhereIsHandler,
    BMRIntentHandler,
    mealRecordIntentHandler,
    updateUserIntentHandler,
    WhatisBMIintentHandler,
    WhatisBMRintentHandler,
    /*standard handlers */
    //  RepeatIntentHandler,
    LaunchRequestHandler,
    CancelIntentHandler,
    StopIntentHandler,
    YesIntentHandler,
    NoIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();

