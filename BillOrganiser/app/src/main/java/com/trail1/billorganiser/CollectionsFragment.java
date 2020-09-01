package com.trail1.billorganiser;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.Toast;

import androidx.fragment.app.Fragment;


public class CollectionsFragment extends Fragment {
    ListView listView;
    ArrayAdapter<String> adapter;
    String[] bills = {"Restaurant", "Shopping", "Insurance"};
    ImageView img;

    public CollectionsFragment(){
        // Empty constructor
    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState){

        View view = inflater.inflate(R.layout.fragment_collections, container, false);
        listView = view.findViewById(R.id.idContainerLV);
        adapter = new ArrayAdapter<String>(getActivity(), android.R.layout.simple_list_item_1, bills);
        listView.setAdapter(adapter);
        img = view.findViewById(R.id.idCollectionsImg);

        listView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> adapterView, View view, int position, long id) {
                switch (position){
                    case 0:
                        Toast.makeText(getContext().getApplicationContext(), "case 0", Toast.LENGTH_LONG).show();
                        img.setImageResource(R.drawable.kfc2);
                        img.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View view) {
                                Intent kfcIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.kfc.com/"));
                                startActivity(kfcIntent);
                            }
                        });
                        break;
                    case 1:
                        Toast.makeText(getContext().getApplicationContext(), "case 1", Toast.LENGTH_LONG).show();
                        img.setImageResource(R.drawable.macy);
                        img.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View view) {
                                Intent kfcIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.macys.com/?cm_sp=navigation-_-top_nav-_-macys_icon&lid=glbtopnav_macys_icon-us"));
                                startActivity(kfcIntent);
                            }
                        });

                        break;

                    case 2:
                        Toast.makeText(getContext().getApplicationContext(), "case 2", Toast.LENGTH_LONG).show();
                        img.setImageResource(R.drawable.carinsu);
                        img.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View view) {
                                Intent kfcIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.geico.com/"));
                                startActivity(kfcIntent);
                            }
                        });

                        break;
                    default:
                }
            }
        });


        return view;
    }
}
