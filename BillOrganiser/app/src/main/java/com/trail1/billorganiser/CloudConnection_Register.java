/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : To register user using amazon's EC Cloud database with the help of parse server
 */

package com.trail1.billorganiser;

import android.annotation.SuppressLint;
import android.app.Application;
import android.util.Log;

import com.parse.Parse;
import com.parse.ParseACL;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;

import java.util.List;

public class CloudConnection_Register extends Application {

    String first_name, last_name, user_name, e_mail, password;
    String userDB = "UserDB";
    String column_FN = "firstname", column_LN = "lastname";
    String column_UN = "username", column_EM = "email", column_PW= "password";

    int errorCode = -1;

    @Override
    public void onCreate() {
        super.onCreate();
        // Enable Local Database
        Parse.enableLocalDatastore(this);

        // Setting up parse server
        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId("myappID")
                // if defined
                .clientKey(null)
                .server("http://ec2-18-216-175-50.us-east-2.compute.amazonaws.com/parse/")
                .build()
        );

    }   // End onCreate method

    // Method to set up the connection to the Amazon's cloud database
    @SuppressLint("LongLogTag")
    public int setUpConnection(){

        final ParseObject user = new ParseObject(userDB);

        List<ParseObject> userList = null;

        ParseQuery<ParseObject> userQuery = ParseQuery.getQuery(userDB);

        try{
            userList = userQuery.find();                    // userList contains all the users in the table
        }
        // if username does not exist                       ???
        catch (ParseException e){
            Log.e("REGISTRATIONERROR!", e.getMessage());
            e.printStackTrace();
        }
        finally {
            if(userList != null) {
                for(ParseObject users: userList){

                    if (users.get(column_UN).equals(user_name)){
                        errorCode = 1;

                        break;
                    }
                    if(users.get(column_EM).equals(e_mail)){
                        errorCode = 2;

                        break;
                    }
                }
            }
        }

        // on Successful registration
        if(errorCode == -1) {
            Log.d("Inserting", "data");
            user.put(column_FN, first_name);
            user.put(column_LN, last_name);
            user.put(column_UN, user_name);
            user.put(column_EM, e_mail);
            user.put(column_PW, password);

            user.saveInBackground();

            ParseUser.enableAutomaticUser();
            ParseACL defaultACL = new ParseACL();

            //  Optionally enable public read access
            //  defaultACL.setPublicReadAccess(true);
            ParseACL.setDefaultACL(defaultACL, true);
        }
        return errorCode;
    }

    // Setter method to set registration data of the user
    public void setRegistrationData(String first_name, String last_name, String user_name, String e_mail, String password){
        this.first_name = first_name;
        this.last_name = last_name;
        this.user_name = user_name;
        this.e_mail = e_mail;
        this.password = password;
    }

}   // End CloudConnection_Register Class