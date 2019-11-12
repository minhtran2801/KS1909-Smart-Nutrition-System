const mysql = require('mysql');

/* standard mysql node module with promises integrated so we can use await to
*  synchronize database calls
**/

const db_con = {
    connection: null,
    connect: function() {
        db_con.connection = mysql.createConnection({
            host: "nutritionhelpdb.c3kmfuraba84.us-east-1.rds.amazonaws.com",
            user: "master_user",
            password: "masterHudeg9m51234"
        });
    },
    webServerConnect: function() {
        db_con.connection = mysql.createConnection({
            host: "localhost",
            user: "ka1901",
            password: "EdZqBio6aDw6NZRP",
             database: "ka1901",
        });
    },
    webServerRun: function(sql) {
        db_con.webServerConnect();
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                return reject(err);
            }
            resolve(rows);
          });
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
    getDailyIntake: function(age, gender) {
        db_con.connect();
        let sql = `SELECT * FROM favorites.RecommendedDailyIntake i, favorites.AgeGroup g ` +
                  `WHERE i.age_group = g.age_group AND g.lower_limit <= ${age} ` +
                  `AND g.upper_limit >= ${age} AND i.gender = '${gender}'`;
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                return reject(err);
            }
            resolve(rows);
          });
      });   
    },
    getNutrientInfo: function(attribute, field) {
        db_con.connect();
        let sql = `SELECT ${field} FROM favorites.NutrientInformation ` +
                  `WHERE name = '${attribute}'`;
        return new Promise(function (resolve, reject) {
          db_con.connection.query(sql, function(err, rows) {
              if(err) {
                return reject(err);
            }
            resolve(rows);
          });
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
