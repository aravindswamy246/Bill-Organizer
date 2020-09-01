/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : Allows the user to register by entering their personal information providing access privileges to the app
 */

package com.trail1.billorganiser;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.util.regex.Matcher;
import java.util.regex.Pattern;


public class RegistrationForm extends AppCompatActivity {

    private String first_name;
    private String last_name;
    private String user_name;
    private String email;
    private String password;

    private String email_regex = "^[\\w!#$%&'*+/=?`{|}~^-]+(?:\\.[\\w!#$%&'*+/=?`{|}~^-]+)*@(?!-)(?:[a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,6}$";
    private String user_name_regex = "^[a-zA-Z0-9._-]{5,}$";

    int error_code = -1;

    private Pattern emailPattern = Pattern.compile(email_regex);
    private Pattern userNamePattern = Pattern.compile(user_name_regex);
    Matcher match;

    EditText fNET;
    EditText lNET;
    EditText uNET;
    EditText eMET;
    EditText pWET;
    EditText rePWET;
    TextView errorTV;

    SharedPreferences myPreferences;
    SharedPreferences.Editor myEditor;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_registration_form);

        Button registerBtn = findViewById(R.id.idRegFormBtn);
        // Retrieving data from the registration form
        fNET = findViewById(R.id.idRegFormFN);
        lNET = findViewById(R.id.idRegFormLN);
        uNET = findViewById(R.id.idRegFormUN);
        eMET = findViewById(R.id.idRegFormEMail);
        pWET = findViewById(R.id.idRegFormPW);
        rePWET = findViewById(R.id.idRegFormRePW);
        errorTV = findViewById(R.id.idResultTV);

        myPreferences = PreferenceManager.getDefaultSharedPreferences(this);
        // Checking SharedPreferences if the user want's to save them on a local data store
        checkSharedPreferences();

        myEditor = myPreferences.edit();

        View.OnClickListener registerListener = new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                //Saving preferences
                myEditor.clear();
                myEditor.putString("fname", first_name);
                myEditor.apply();
                myEditor.putString("lname", last_name);
                myEditor.apply();
                myEditor.putString("uname", user_name);
                myEditor.apply();
                myEditor.putString("email", email);
                myEditor.apply();
                myEditor.putString("password", password);
                myEditor.apply();

                if(validateForm()) {
                    CloudConnection_Register sendRegistrationDataToCloud = new CloudConnection_Register();
                    sendRegistrationDataToCloud.setRegistrationData(first_name, last_name, user_name, email, password);

                    // Calling setUpConnection() returns an error_code based on the user entry to the registration form
                    error_code = sendRegistrationDataToCloud.setUpConnection();
                    if(error_code > 0){
                        String setErrorText;
                        if(error_code == 1) {
                            setErrorText = "Username already exists!";
                            errorTV.setText(setErrorText);
                        }
                        else if(error_code == 2) {
                            setErrorText = "Email already exists!";
                            errorTV.setText("");
                            errorTV.setText(setErrorText);
                        }
                        else {
                            setErrorText = "Unknown Error!";
                            errorTV.setText(setErrorText);
                        }
                    }

                    else{
                        Toast.makeText(RegistrationForm.this, "Registration Successful!", Toast.LENGTH_LONG).show();
                        Intent loginIntent = new Intent(RegistrationForm.this, Login.class);
                        startActivity(loginIntent);
                    }

                }
            }
        };
        registerBtn.setOnClickListener(registerListener);
    }

    // Method to check the SharedPreferences
    private void checkSharedPreferences() {
        String fname = myPreferences.getString("fname", "");
        String lname = myPreferences.getString("lname", "");
        String uname = myPreferences.getString("uname", "");
        String email = myPreferences.getString("email", "");
        String password = myPreferences.getString("password", "");

        if(!fname.equals(""))
            fNET.setText(fname);
        if(!lname.equals(""))
            lNET.setText(lname);
        if(!uname.equals(""))
            uNET.setText(uname);
        if(!email.equals(""))
            eMET.setText(email);
        if(!password.equals(""))
            pWET.setText(password);
    }

    // Method to validate the registration form
    private boolean validateForm() {

        // Converting the retrieved data to respective data types
        first_name = fNET.getText().toString();
        last_name = lNET.getText().toString().trim();
        user_name = uNET.getText().toString().trim().toLowerCase();
        email = eMET.getText().toString().trim().toLowerCase();
        password = pWET.getText().toString();
        String rePassword = rePWET.getText().toString();

        String errorMsg;

        if(first_name.isEmpty()){
            errorMsg = "First Name cannot be empty!";
            fNET.setError(errorMsg);

            return false;
        }
        else
            fNET.setError(null);

        if(last_name.isEmpty()){
            errorMsg = "Last Name cannot be empty!";
            lNET.setError(errorMsg);

            return false;
        }
        else
            lNET.setError(null);

        if(user_name.isEmpty()){
            errorMsg = "username cannot be empty!";
            uNET.setError(errorMsg);

            return false;
        }
        else {
            match = userNamePattern.matcher(user_name);
            if(!match.matches()){
                errorMsg = "username is not allowed!";
                uNET.setError(errorMsg);

                return false;
            }
            if(user_name.length() <6){
                errorMsg = "Please enter more than 5 characters";
                uNET.setError(errorMsg);

                return false;
            }
            else
               uNET.setError(null);
        }

        if(email.isEmpty()){
            errorMsg = "E-mail cannot be empty!";
            eMET.setError(errorMsg);

            return false;
        }
        else{
            match = emailPattern.matcher(email);
            if(!match.matches()) {
                errorMsg = "Please enter a valid email address!";
                eMET.setError(errorMsg);

                return false;
            }
            else
                eMET.setError(null);
        }

        if(password.isEmpty()){
            errorMsg = "Password cannot be empty!";
            pWET.setError(errorMsg);

            return false;
        }
        else{
            if(password.length() < 6){
                errorMsg = "Please enter more than 5 characters!";
                pWET.setError(errorMsg);

                return false;
            }
            else
                pWET.setError(null);
        }

        if(rePassword.isEmpty()){
            errorMsg = "Please re-enter password";
            rePWET.setError(errorMsg);

            return false;
        }
        else {
            if(!password.equals(rePassword)){
                errorMsg = "Password do not match!";
                rePWET.setError(errorMsg);

                return false;
            }
            else
                rePWET.setError(null);
        }

        return true;
    }
}