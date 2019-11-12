const mysql = require('mysql');

/* standard mysql node module with promises integrated so we can use await to
*  synchronize database calls
**/

const db_con = {
    connection: null,
    connect: function() {
        db_con.connection = mysql.createConnection({
            host: "alexadatabase.cvoyxhepfo1u.us-east-1.rds.amazonaws.com",
            user: "alexadb",
            password: "Alexa2019"
        });
    },
    runQuery: function(sql) {
        db_con.connect();
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) { 
                return reject(err);
            }
            resolve(rows);
          });
      });
    },
    getMeal: function(timestamp, mealType, email) {
        db_con.connect();
        let sql = `SELECT * FROM AlexaDatabase.scan ` +
                  `WHERE timestamp LIKE '${timestamp}%' ` +
                  `AND mealType = '${mealType}' ` + 
                  `AND email = '${email}'`;
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
            if(err) {
                return reject(err);
            } else {
                console.log("rows check existed meal" + rows);
            }
            
            resolve(rows);
          });
      });   
    },
     getIngredients: function(email, foodName) {
        db_con.connect();
        let sql = `SELECT * FROM AlexaDatabase.Ingredients ` +
                  `WHERE email = '${email}' ` +
                  `AND dishName = '${foodName}'`;
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
            if(err) {
                return reject(err);
            } else {
                console.log("rows ingredients" + rows);
            }
            
            resolve(rows);
          });
      });   
    },
    getUser: function(userName) {
        db_con.connect();
        let sql = `SELECT email FROM AlexaDatabase.user ` +
                  `WHERE firstName = '${userName}'; `;
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                return reject(err);
            } else {
                console.log("rows email" + rows);
            }
            resolve(rows);
          });
      });   
    },
    getUserWeight: function(userName) {
        db_con.connect();
        let sql = `SELECT weight FROM AlexaDatabase.user ` +
                  `WHERE firstName = '${userName}'; `;
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                return reject(err);
            } else {
                console.log("rows weight" + rows);
            }
            resolve(rows);
          });
      });   
    },
     getNumRows: function() {
        db_con.connect();
        let sql = 'SELECT id FROM AlexaDatabase.food_detection_analysis ORDER BY id DESC LIMIT 1';
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                return reject(err);
            } else {
                console.log("rows weight" + rows);
            }
            resolve(rows);
          });
      });   
    },
    insertSQLNutrition: function(imgid, foodname, email, cal, fat, carb, prot, mealTime, mealType, weight) {
        db_con.connect();
        let sql = `INSERT INTO AlexaDatabase.food_detection_analysis(imgid, foodname, email, cal, fat, carb, prot) ` +
                  `VALUES('${imgid}', '${foodname}', '${email}', '${cal}', '${fat}', '${carb}', '${prot}')`;
       
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                console.log('Insert food_detection_analysis ' + err.message);
            } else {
                console.log("inserted food_detection_analysis " + rows.insertId);
            }
          });
           
          sql = `INSERT INTO AlexaDatabase.scan(timestamp, mealType, weight, sensorID, email, img, WI) ` +
                `VALUES('${mealTime}','${mealType}','${weight}','1','${email}','${imgid}', '500')`;
                
         db_con.connection.query(sql, function(err, rows) {
              if(err) {
                console.log('Insert scan ' + err.message);
            } else {
                console.log("inserted scan" + rows.insertId);
            }
          });
    },
     insertIngredients: function(email, foodName, ingredients, cal, fat, carb, prot) {
        db_con.connect();
        let sql = `INSERT INTO AlexaDatabase.Ingredients(email, dishName, ingredients, cal, fat, carb, prot) ` +
                  `VALUES('${email}', '${foodName}', '${ingredients}', '${cal}', '${fat}', '${carb}', '${prot}')`;
       
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                console.log('Insert Ingredients ' + err.message);
            } else {
                console.log("inserted Ingredients " + rows.insertId);
            }
          });
    },
    updateSQLNutrition: function(imgid, foodname, email, cal, fat, carb, prot, mealTime, mealType) {
        db_con.connect();

        let sql = `UPDATE AlexaDatabase.food_detection_analysis f, AlexaDatabase.scan s ` +
                  `SET foodname = '${foodname}', cal = '${cal}', fat = '${fat}', carb = '${carb}', prot =  '${prot}' ` +
                   `WHERE s.timestamp LIKE '${mealTime}%' ` +
                    `AND s.mealType = '${mealType}' ` +
                    `AND s.email = '${email}' ` +
                    `AND s.img = '${imgid}' ` + 
                    `AND s.img = f.imgid `;
       
        console.log(sql);
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                console.log('Update food_detection_analysis ' + err.message);
            } else {
                console.log("Updated food_detection_analysis " + rows.insertId);
            }
          });
    },
    close: function() {
        return new Promise(function(resolve, reject) {
            db_con.connection.end(function(err) {
                if(err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
}

module.exports = {
    db_con
};
