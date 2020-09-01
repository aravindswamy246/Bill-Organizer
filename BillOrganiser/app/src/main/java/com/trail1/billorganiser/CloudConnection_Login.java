/*
* Author    : Eswar Aravind Swamy Adari
* Functions : To authenticate login credentials of an user using amazon's EC Cloud database with the help of parse server
*/

package com.trail1.billorganiser;

import android.app.Application;
import android.util.Log;

import com.parse.Parse;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import java.util.List;

public class CloudConnection_Login extends Application {

    private String user_name;
    private String password;

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

    // Setter method to set username and password
    public void setLoginData(String user_name, String password) {
        this.user_name = user_name;
        this.password = password;
    }

    // Method to authenticate user
    public int checkLoginInfo() {
        String User_DB = "UserDB";
        String column_UN = "username", column_PW = "password";
        int error_code = 0;

        List<ParseObject> users_list = null;

        ParseQuery loginQuery = ParseQuery.getQuery(User_DB);

        try {
            users_list = loginQuery.find();
        } catch (ParseException e) {
            Log.d("LOGINERROR", e.getMessage());
            e.printStackTrace();
        } finally{

            if (users_list != null) {

                for (ParseObject user : users_list) {
                    if (user.get(column_UN).equals(user_name)) {
                        if (user.get(column_PW).equals(password)) {
                            error_code = 1;
                            break;                      // Authenticated User
                        } else {
                            error_code = 2;             // Invalid password error_code
                            break;
                        }
                    }
                }
                if (error_code == 0)
                    error_code = 3;                     // Invalid username error_code
            } else
                error_code = 4;                         // No Data Exists error_code

            return error_code;
        }
    }   // End checkLoginInfo() method

}   // End CloudConnection_Login Class
