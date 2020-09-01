/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : Login page authenticates the user and allows the user to login/ register on the choice of the user
 */

package com.trail1.billorganiser;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public class Login extends AppCompatActivity {

    private String user_name;
    private String password;
    private boolean remember_me = false;

    int error_code = -1;

    EditText usernameET;
    EditText passwordEt;
    CheckBox rememberMeCB;

    TextView errorTV;

    SharedPreferences myLoginPreferences, mySessionPreferences;
    SharedPreferences.Editor myLoginEditor, mySessionEditor;
    String preferences_un_key = "l_uname", preferences_pw_key = "l_pass", preferences_cb_key = "l_rememberme";

    String errorText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        final Button loginBtn = findViewById(R.id.idBtnLogin);

        usernameET = findViewById(R.id.idTxtLogin);
        passwordEt = findViewById(R.id.idTxtPswd);
        rememberMeCB = findViewById(R.id.idRememberMe);
        errorTV = findViewById(R.id.idLoginErrorTV);

        // Setting up the SharedPreferences to save the user's data
        myLoginPreferences = PreferenceManager.getDefaultSharedPreferences(Login.this);
        mySessionPreferences = PreferenceManager.getDefaultSharedPreferences(Login.this);
        checkLoginSharedPreferences();
        myLoginEditor = myLoginPreferences.edit();
        mySessionEditor = mySessionPreferences.edit();

        View.OnClickListener loginListener = new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                user_name = usernameET.getText().toString();
                password = passwordEt.getText().toString();

                // Storing user data in shared preferences for maintaining session data
                {
                    mySessionEditor.clear();
                    mySessionEditor.putString(preferences_un_key, user_name);
                    mySessionEditor.apply();
                }

                // Storing shared preferences if the user chooses to
                if(rememberMeCB.isChecked())
                    remember_me = true;
                if (remember_me) {
                    myLoginEditor.clear();
                    myLoginEditor.putString(preferences_un_key, user_name);
                    myLoginEditor.apply();
                    myLoginEditor.putString(preferences_pw_key, password);
                    myLoginEditor.apply();
                    myLoginEditor.putBoolean(preferences_cb_key, remember_me);
                    myLoginEditor.apply();
                }


                else {
                    myLoginEditor.clear();
                    myLoginEditor.putString(preferences_un_key, "");
                    myLoginEditor.apply();
                    myLoginEditor.putString(preferences_pw_key, "");
                    myLoginEditor.apply();
                    myLoginEditor.putBoolean(preferences_cb_key, false);
                    myLoginEditor.apply();

                }

                if (validateLoginForm()) {
                    CloudConnection_Login authenticateUser = new CloudConnection_Login();
                    authenticateUser.setLoginData(user_name, password);

                    error_code = authenticateUser.checkLoginInfo();
                    if (error_code == 1) {
                        Toast.makeText(Login.this, "Login Successful!", Toast.LENGTH_LONG).show();
                        Intent loginIntent = new Intent(Login.this, FirstPage.class);
                        startActivity(loginIntent);
                    } else if (error_code == 2) {
                        errorText = "Invalid password!";
                        errorTV.setText(errorText);
                    } else if (error_code == 3) {
                        errorText = "Invalid username!";
                        errorTV.setText(errorText);
                    } else {
                        errorText = "Invalid username/password";
                        errorTV.setText(errorText);
                    }
                }
            }
        };
        loginBtn.setOnClickListener(loginListener);


        TextView registerTV = findViewById(R.id.idLoginFormRegisterTV);
        View.OnClickListener registerListener = new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                Intent registerIntent = new Intent(Login.this, RegistrationForm.class);
                startActivity(registerIntent);
            }
        };

        registerTV.setOnClickListener(registerListener);
    }   // End onCreate method

    // Method to validate user's login information
    private boolean validateLoginForm(){
        user_name = usernameET.getText().toString();
        password = passwordEt.getText().toString();

        if(user_name.length() == 0){
            errorText = "username cannot be empty";
            usernameET.setError(errorText);

            return false;
        }

        if(password.length() == 0){
            errorText = "password cannot be empty";
            passwordEt.setError(errorText);

            return false;
        }

        return true;
    }

    // Method to display user's data based on the user's choice
    private void checkLoginSharedPreferences() {
        String p_uname = myLoginPreferences.getString(preferences_un_key, "");
        String p_password = myLoginPreferences.getString(preferences_pw_key, "");
        boolean p_checkbox = myLoginPreferences.getBoolean(preferences_cb_key, false);

        if(!p_uname.equals(""))
            usernameET.setText(p_uname);
        if(!p_password.equals(""))
            passwordEt.setText(p_password);
        if(p_checkbox)
            rememberMeCB.setChecked(true);
    }
}   // End Login Class