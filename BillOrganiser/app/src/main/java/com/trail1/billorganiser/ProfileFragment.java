/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : Allows the user to display their personal data and allows them to modify on their choice
 */

package com.trail1.billorganiser;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentTransaction;

import android.preference.PreferenceManager;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.floatingactionbutton.FloatingActionButton;
import com.parse.ParseACL;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;

import java.util.List;

public class ProfileFragment extends Fragment {

    private String username;
    private String password;

    private TextView userTitle;
    private TextView userEmail;
    private TextView errorTV;

    private EditText oldPassword;
    private EditText newPassword;
    private EditText confirmPassword;

    String User_DB = "UserDB";
    String column_FN = "firstname", column_LN = "lastname";
    String column_UN = "username", column_EM = "email", column_PW= "password";
    String EnteredPassword, NewPassword, ConfirmPassword;

    SharedPreferences mySessionPreferences;
    SharedPreferences.Editor mySessionEditor;
    String preferences_un_key = "l_uname", preferences_pw_key = "l_pass";

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        // Inflate the layout for this fragment
        View view = inflater.inflate(R.layout.fragment_profile, container, false);

        userTitle = view.findViewById(R.id.idProfileUserTitle);
        userEmail = view.findViewById(R.id.idProfileEmailTV);
        oldPassword = view.findViewById(R.id.idOldPasswordET);
        newPassword = view.findViewById(R.id.idNewPasswordET);
        confirmPassword = view.findViewById(R.id.idConfirmNewPasswordET);
        errorTV = view.findViewById(R.id.idProfileErrorTV);

        // Setting up the SharedPreferences to save the user's data
        mySessionPreferences = PreferenceManager.getDefaultSharedPreferences(getActivity().getApplicationContext());
        checkLoginSharedPreferences();
        mySessionEditor = mySessionPreferences.edit();

        CloudConnection_Login userData = new CloudConnection_Login();
        userData.setLoginData(username, password);

        String FirstName, Email;

        final ParseObject user = new ParseObject(User_DB);
        List<ParseObject> users_list = null;
        ParseQuery loginQuery = ParseQuery.getQuery(User_DB);

        try{
            users_list = loginQuery.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        finally {
            if (users_list != null) {

                for (ParseObject users : users_list) {
                    if (users.get(column_UN).equals(username)) {
                        if (users.get(column_PW).equals(password)) {
                            FirstName = users.get(column_FN).toString();
                            Email = users.get(column_EM).toString();
                            userTitle.setText(FirstName);
                            userEmail.setText(Email);
                        }
                    }
                }
            }
        }

        Button update = view.findViewById(R.id.idBtnUpdate);
        update.setOnClickListener(new View.OnClickListener(){

            @Override
            public void onClick(View view) {
                EnteredPassword = oldPassword.getText().toString();
                NewPassword = newPassword.getText().toString();
                ConfirmPassword = confirmPassword.getText().toString();

                int error_code = validateForm(EnteredPassword, NewPassword, ConfirmPassword);
                if(error_code == 0){
                    boolean flag = false;
                    try {
                        flag = updatePassword(NewPassword);
                    }
                    catch (Exception e){
                        e.printStackTrace();
                    }

                    if(flag) {
                        Toast.makeText(getActivity().getApplicationContext(), "Update Successful!", Toast.LENGTH_LONG).show();
                        FragmentTransaction fTransaction = getFragmentManager().beginTransaction();
                        fTransaction.replace(R.id.idNavHostFrag, new HomeFragment());
                        fTransaction.commit();
                    }
                    else
                        Toast.makeText(getActivity().getApplicationContext(), "Update failed!", Toast.LENGTH_LONG).show();
                }
                else if(error_code == 1){
                    errorTV.setText("Incorrect old password!");
                }
                else if(error_code == 3)
                    errorTV.setText("Poor password strength!");
                else
                    errorTV.setText("Password Mismatch!");
            }
        });

        return view;
    }

    public int validateForm(String EnteredPassword, String NewPassword, String ConfirmPassword){

        if(!EnteredPassword.isEmpty() && EnteredPassword.equals(password)){
            if(!NewPassword.isEmpty() && !ConfirmPassword.isEmpty() && NewPassword.equals(ConfirmPassword)){
                if(NewPassword.length() <5){
                    return 3;   // Invalid Password length
                }
                return 0;   // Successful case
            }
            else return 2;  // Error_Code for invalid new password
        }
        else{
            return 1;       // Error_Code for invalid old password
        }
    }

    // Method to display user's data based on the user's choice
    private void checkLoginSharedPreferences() {
        username = mySessionPreferences.getString(preferences_un_key, "");
        password = mySessionPreferences.getString(preferences_pw_key, "");
    }

    //
    private boolean updatePassword(String newPassword) throws ParseException {
        final ParseObject user = new ParseObject(User_DB);
        List<ParseObject> users_list = null;
        ParseQuery loginQuery = ParseQuery.getQuery(User_DB);

        try{
            users_list = loginQuery.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        finally {
            if (users_list != null) {

                for (ParseObject users : users_list) {
                    if (users.get(column_UN).equals(username)) {
                        if (users.get(column_PW).equals(password)) {
                            users.put(column_PW, newPassword);

                            users.save();

                            ParseUser.enableAutomaticUser();
                            ParseACL defaultACL = new ParseACL();
                            //  Optionally enable public read access
                            //  defaultACL.setPublicReadAccess(true);
                            ParseACL.setDefaultACL(defaultACL, true);

                            return true;
                        }
                    }
                }
            }
        }

        return false;
    }

}