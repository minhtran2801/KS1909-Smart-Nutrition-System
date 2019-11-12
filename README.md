# Alexa-Nutrition-System-Interface
Repo for our WSU professional experience project building an Alexa voice interface for a existing nutrition information system.

GROUP NAME: KS1909

REST API Key - ed9c317b104b4017a1eba0b7d0911e15\
REST API Shared Secret - 357873c14ef943399eef3f76ca45e3b8

Instructions for Setting up local Alexa dev environment. We will use windows as it will save people having to set up linux environments.

INSTALL NODE VERSION MANAGER FOR WINDOWS
1) Install windows nvm - manages the versions of node js installed so we can use matching version that aws lambda uses.
2) Get it from https://github.com/coreybutler/nvm-windows/releases download the nvm-setup.zip
3) Extract and run the installer, it is a cmd line app so to check it is working open a command prompt and enter - nvm
4) You should see a menu of command line options for the nvm tool
5) At command prompt enter - nvm install v8.10 (the latest runtime that alexa supports) ATTENTION - Record where nvm is installed
   it may be useful if you have the same error i had (explained below this).
6) Once installed enter - nvm use 8.10.0 64 (or 32 if your on windows 32 bit), this will set this version of node to be used
7) PROBLEM - nvm does not like spaces in file folder names and the adove will fail if you have one. To fix this you can edit the file path 
  of the settings file that nvm uses to use a different file syntax. 
    7.1) First identify the folder that is causing the issue, for me it was C:/Users/My PC/....
    7.2) From the C:/Users directory i entered - dir /X, this command will list the directories showing their alias names, for me 
         the <My Pc> directory was shown as being listed as MYPC\~1 as well.
    7.3) After this i went to the settings.txt file that you will find in the nvm install directory and i edited the root file path  
         replacing the <My Pc> part with <MYPC~1>, after this nvm worked correctly.
8) Now we should see the output saying "Now using node v8.10.0 (64-bit)".

SETTING UP AWSCLI
1) We need python now so go to https://www.python.org/downloads/release/python-370/ and download the windows executable package and install.
2) Now reopen command prompt and enter - pip install awscli --upgrade, this will install the AWS cli for us. You may get a notice 
   that pip can be upgraded, follow the instructions if you want to upgrade pip (i did).
3) Now enter - aws --version, you should see version output for the amazon cli.
4) PROBLEM - i had issues installing awscli when i followed the official docs, the above cmd should work but if you have issues with 
   the command prompt not recognizing the 'aws' cmd then you need to add its path to the windows PATH variable. (google that)
   
GET MICROSOFT VISUAL STUDIO CODE
1) Download from - https://code.visualstudio.com/Download

SET UP ALEXA SKILLS KLL CLI
1) enter 'npm install -g ask-cli' into command prompt this installs a cli that allows us to create and manage alexa skills locally.
2) enter 'ask init' you will need to refer to this guide on creating a IAM user on your amazon account which we use to link to your local
   setup allowing it to run correctly. https://developer.amazon.com/docs/smapi/set-up-credentials-for-an-amazon-web-services-account.html

SET UP GIT FOR WINDOWS
1) You might as well use the new fancy pants GUI they have built https://desktop.github.com/ 
2) Download and install

CLONE THIS REPOSITORY
1) Create an empty folder that you want to work out of somewhere on you machine.
2) Then use the clone link at the top right to clone this repo into that folder and you should have everything there as needed.
3) Open that folder in VS code, you now have all the files needed to work on.



SETTING UP A LAMBDA FUNCTION
1) Create an amazon AWS account (if you have not already) - https://console.aws.amazon.com/lambda
2) Change your region (Top right hand corner)  to N.Virginia (This is because you will not be able to use your skill without being in that region, for whatever reason?)
3) Go to Services > Lambda > Functions > Create Function
4) Create your function from scratch with whatever name you decide on the project being.
5) Once you have created the lambda function get the 'ARN' (Top right hand corner)
6) This will be placed into the config file inside .ask (Instructions below)
7) Choose "Add Trigger" and add "Alexa Skill Kit"
8) Obtain your Skill ID in the next step and save

SETTING UP THE SKILL
1) Create an alexa developer account (if you have not already) - https://developer.amazon.com/alexa/console/ask
2) Navigate to https://developer.amazon.com/alexa/console/ask
3) Click 'Create Skill'
4) Enter the project name
5) Select Custom
6) Click Create Skill
7) Start from scratch 
8) Click Choose 
9) Navigate to the side menu item - Endpoint
10) Choose AWS Lambda ARN
11) Input the ARN aquired in the previous task
12) Your Skill ID is also listed here and will be used in the next help task 

SETTING UP THE CODE TO LINK TO YOUR AWS/LAMBDA
1) Navigate to .ask inside the skill folder (within visual studio code)
2) Place the previously aquired skill_id into the "skill_id" section (line 4)
3) Place the previously aquired ARN into the "arn" section (line 18)
4) Click 'Terminal' in the header of Visual Studio Code
5) 'New Terminal'
6) Enter 'ask deploy' if you are greeted with an error saying wrong etag or revision ID enter   'ask deploy -f'  this will force the execution


  


