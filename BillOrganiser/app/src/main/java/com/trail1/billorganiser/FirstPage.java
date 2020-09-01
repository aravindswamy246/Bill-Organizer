/*
 * Author    : Eswar Aravind Swamy Adari
 * Functions : Displays the toolbar/ actionbar and also the navigation bar
 */

package com.trail1.billorganiser;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.GravityCompat;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentTransaction;
import androidx.navigation.NavController;
import androidx.navigation.NavDestination;
import androidx.navigation.Navigation;
import androidx.navigation.ui.NavigationUI;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

import com.google.android.material.navigation.NavigationView;

public class FirstPage extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_first_page);

        // Displays the drawer layout which is the toolbar
        final DrawerLayout drawerL = findViewById(R.id.idDrawerLayout);
        findViewById(R.id.idMenu).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                drawerL.openDrawer(GravityCompat.START);
            }
        });

        // Set up the NavigationView to display the navigation bar
        final NavigationView navView = findViewById(R.id.idNavView);
        navView.setItemIconTintList(null);

        NavController navController = Navigation.findNavController(this, R.id.idNavHostFrag);
        NavigationUI.setupWithNavController(navView, navController);

        // Set respective text view on tool bar
        final TextView toolbarTitleTV = findViewById(R.id.idTitleTxtToolBar);
        navController.addOnDestinationChangedListener(new NavController.OnDestinationChangedListener() {
            @Override
            public void onDestinationChanged(@NonNull NavController controller, @NonNull NavDestination destination, @Nullable Bundle arguments) {
                toolbarTitleTV.setText(destination.getLabel());
            }
        });

        // Fragment Transaction
        FragmentTransaction fragmentTransaction = getSupportFragmentManager().beginTransaction();
//        fragmentTransaction.add(R.id.idNavHostFrag, new HomeFragment()).commit();

        // Logout ImageView to perform logout action of an user
        ImageView logoutIV = findViewById(R.id.idLogoutIV);

        logoutIV.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View view) {
                SharedPreferences myLoginPreferences;
                SharedPreferences.Editor myLoginEditor;
                myLoginPreferences = PreferenceManager.getDefaultSharedPreferences(FirstPage.this);
                myLoginEditor = myLoginPreferences.edit();
                myLoginEditor.clear();
                myLoginEditor.commit();

                finish();
                startActivity(new Intent(FirstPage.this, Login.class));
            }
        });
    }   // End onCreate method
}   // End FirstPage Class